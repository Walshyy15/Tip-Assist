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

function extractPartnersFromTables(tables) {
  if (!tables || tables.length === 0) {
    return [];
  }

  let bestTable = null;
  let bestScore = 0;

  for (const table of tables) {
    if (!table.cells || table.cells.length === 0) continue;

    const headerCells = table.cells.filter(cell => cell.kind === 'columnHeader' || cell.rowIndex === 0);
    const headerText = headerCells.map(c => (c.content || '').toLowerCase()).join(' ');

    let score = 0;
    if (headerText.includes('partner')) score += 3;
    if (headerText.includes('name')) score += 2;
    if (headerText.includes('number')) score += 2;
    if (headerText.includes('hour')) score += 3;

    if (table.rowCount >= 3 && table.columnCount >= 3) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTable = table;
    }
  }

  if (!bestTable || bestScore === 0) {
    return [];
  }

  const headers = {};
  const headerCells = bestTable.cells.filter(cell => cell.kind === 'columnHeader' || cell.rowIndex === 0);

  headerCells.forEach(cell => {
    const text = (cell.content || '').toLowerCase();
    const colIdx = cell.columnIndex;

    if (text.includes('name') && !text.includes('number')) {
      headers.name = colIdx;
    } else if (text.includes('number')) {
      headers.number = colIdx;
    } else if (text.includes('hour')) {
      headers.hours = colIdx;
    }
  });

  const dataCells = bestTable.cells.filter(cell =>
    cell.kind !== 'columnHeader' && cell.rowIndex > 0
  );

  const rowsMap = {};
  dataCells.forEach(cell => {
    const rowIdx = cell.rowIndex;
    if (!rowsMap[rowIdx]) {
      rowsMap[rowIdx] = {};
    }
    rowsMap[rowIdx][cell.columnIndex] = cell.content || '';
  });

  const partners = [];
  Object.values(rowsMap).forEach(row => {
    const partnerName = headers.name !== undefined ? row[headers.name] : '';
    const partnerNumber = headers.number !== undefined ? row[headers.number] : '';
    const hoursText = headers.hours !== undefined ? row[headers.hours] : '';

    if (!partnerName && !partnerNumber && !hoursText) {
      return;
    }

    const tippableHours = parseFloat(hoursText.replace(/[^\d.-]/g, '')) || 0;

    partners.push({
      partnerName: partnerName.trim(),
      partnerNumber: partnerNumber.trim(),
      tippableHours: tippableHours
    });
  });

  return partners.filter(p => p.partnerName || p.partnerNumber);
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
