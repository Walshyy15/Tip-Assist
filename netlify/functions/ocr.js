const { Buffer } = require('buffer');

const MAX_POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1500;

async function pollOperationResult(operationUrl, apiKey) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    const response = await fetch(operationUrl, {
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Polling failed with status ${response.status}`);
    }

    const result = await response.json();

    if (result.status === 'succeeded') {
      return result;
    } else if (result.status === 'failed') {
      throw new Error(`OCR analysis failed: ${result.error || 'Unknown error'}`);
    }
  }

  throw new Error('OCR polling timeout - analysis took too long');
}

function scoreTable(table) {
  if (!table || !table.cells || table.cells.length === 0) {
    return 0;
  }

  const allText = table.cells.map(c => (c.content || '').toLowerCase()).join(' ');

  let score = 0;
  if (allText.includes('partner')) score += 3;
  if (allText.includes('name')) score += 2;
  if (allText.includes('number')) score += 2;
  if (allText.includes('hour') || allText.includes('tippable')) score += 3;

  if (table.rowCount >= 3 && table.columnCount >= 2) {
    score += 1;
  }

  return score;
}

function extractHeaders(table) {
  const headers = {};
  const headerRow = table.cells.filter(cell => cell.rowIndex === 0);

  headerRow.forEach(cell => {
    const text = (cell.content || '').toLowerCase().trim();
    const colIdx = cell.columnIndex;

    if ((text.includes('name') || text.includes('partner')) && !text.includes('number')) {
      headers.name = colIdx;
    } else if (text.includes('number') || text.includes('#')) {
      headers.number = colIdx;
    } else if (text.includes('hour') || text.includes('tippable')) {
      headers.hours = colIdx;
    }
  });

  if (Object.keys(headers).length === 0) {
    const firstRowCells = headerRow;
    if (firstRowCells.length >= 2) {
      headers.name = 0;
      headers.number = 1;
      if (firstRowCells.length >= 3) {
        headers.hours = firstRowCells.length - 1;
      }
    }
  }

  return headers;
}

function extractPartnersFromTables(tables) {
  if (!tables || tables.length === 0) {
    return [];
  }

  const scoredTables = tables
    .map(table => ({ table, score: scoreTable(table) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredTables.length === 0) {
    return [];
  }

  const partners = [];
  const seenKeys = new Set();

  scoredTables.forEach(({ table }) => {
    const headers = extractHeaders(table);

    const dataCells = table.cells.filter(cell => cell.rowIndex > 0);
    const rowsMap = {};

    dataCells.forEach(cell => {
      const rowIdx = cell.rowIndex;
      if (!rowsMap[rowIdx]) {
        rowsMap[rowIdx] = {};
      }
      rowsMap[rowIdx][cell.columnIndex] = cell.content || '';
    });

    Object.entries(rowsMap).forEach(([, row]) => {
      let partnerName = '';
      let partnerNumber = '';
      let hoursText = '';

      if (headers.name !== undefined) {
        partnerName = row[headers.name] || '';
      }
      if (headers.number !== undefined) {
        partnerNumber = row[headers.number] || '';
      }
      if (headers.hours !== undefined) {
        hoursText = row[headers.hours] || '';
      }

      if (headers.hours === undefined) {
        const rowValues = Object.values(row);
        for (let i = rowValues.length - 1; i >= 0; i--) {
          const val = rowValues[i];
          const numericVal = parseFloat(val.replace(/[^\d.-]/g, ''));
          if (!isNaN(numericVal) && numericVal > 0) {
            hoursText = val;
            break;
          }
        }
      }

      if (!partnerName && !partnerNumber) {
        return;
      }

      const cleanedHoursText = hoursText.replace(/[^\d.-]/g, '');
      let tippableHours = parseFloat(cleanedHoursText);

      if (isNaN(tippableHours) || tippableHours < 0) {
        tippableHours = 0;
      }

      const key = `${partnerName.trim()}|${partnerNumber.trim()}|${tippableHours}`;
      if (seenKeys.has(key)) {
        return;
      }

      seenKeys.add(key);
      partners.push({
        partnerName: partnerName.trim(),
        partnerNumber: partnerNumber.trim(),
        tippableHours: tippableHours
      });
    });
  });

  return partners;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const apiKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server configuration error',
        details: 'Azure Document Intelligence credentials not configured'
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON in request body' })
    };
  }

  const { imageBase64, mimeType } = body;

  if (!imageBase64 || !mimeType) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing imageBase64 or mimeType in request' })
    };
  }

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');

    const analyzeUrl = `${endpoint}/formrecognizer/documentModels/prebuilt-layout:analyze?api-version=2023-07-31`;

    const analyzeResponse = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'Ocp-Apim-Subscription-Key': apiKey
      },
      body: imageBuffer
    });

    if (!analyzeResponse.ok) {
      const errorText = await analyzeResponse.text();
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Azure Document Intelligence request failed',
          details: errorText
        })
      };
    }

    const operationLocation = analyzeResponse.headers.get('operation-location');
    if (!operationLocation) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'No operation-location header received from Azure'
        })
      };
    }

    const result = await pollOperationResult(operationLocation, apiKey);

    const partners = extractPartnersFromTables(result.analyzeResult?.tables || []);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        partners: partners,
        meta: {
          source: 'azure-document-intelligence',
          model: 'prebuilt-layout',
          pageCount: result.analyzeResult?.pages?.length || 0
        }
      })
    };

  } catch (error) {
    console.error('OCR processing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'OCR processing failed',
        details: error.message
      })
    };
  }
};
