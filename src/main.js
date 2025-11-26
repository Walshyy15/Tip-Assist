const state = {
  partners: [],
  totalTips: 0,
  totalHours: 0,
  cashInventory: {
    twenties: 0,
    tens: 0,
    fives: 0,
    ones: 0
  }
};

let selectedFile = null;
let nextPartnerId = 1;

const elements = {
  imageInput: document.getElementById('imageInput'),
  fileInfo: document.getElementById('fileInfo'),
  imagePreview: document.getElementById('imagePreview'),
  processBtn: document.getElementById('processBtn'),
  processingSection: document.getElementById('processingSection'),
  dataSection: document.getElementById('dataSection'),
  partnersTableBody: document.getElementById('partnersTableBody'),
  addPartnerBtn: document.getElementById('addPartnerBtn'),
  totalTipsInput: document.getElementById('totalTipsInput'),
  twentiesInput: document.getElementById('twentiesInput'),
  tensInput: document.getElementById('tensInput'),
  fivesInput: document.getElementById('fivesInput'),
  onesInput: document.getElementById('onesInput'),
  calculateBtn: document.getElementById('calculateBtn'),
  resultsSection: document.getElementById('resultsSection'),
  partnerCardsContainer: document.getElementById('partnerCardsContainer'),
  summaryTotalHours: document.getElementById('summaryTotalHours'),
  summaryHourlyRate: document.getElementById('summaryHourlyRate'),
  summaryDistributed: document.getElementById('summaryDistributed'),
  formulaTotalTips: document.getElementById('formulaTotalTips'),
  formulaTotalHours: document.getElementById('formulaTotalHours'),
  formulaRate: document.getElementById('formulaRate'),
  billsNeeded: document.getElementById('billsNeeded'),
  warningMessage: document.getElementById('warningMessage'),
  printBtn: document.getElementById('printBtn'),
  exportCsvBtn: document.getElementById('exportCsvBtn')
};

elements.imageInput.addEventListener('change', handleFileSelect);
elements.processBtn.addEventListener('click', processImage);
elements.addPartnerBtn.addEventListener('click', addPartnerRow);
elements.calculateBtn.addEventListener('click', calculateTips);
elements.printBtn.addEventListener('click', () => window.print());
elements.exportCsvBtn.addEventListener('click', exportToCsv);

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  selectedFile = file;
  elements.fileInfo.textContent = `Selected: ${file.name}`;
  elements.processBtn.disabled = false;

  const reader = new FileReader();
  reader.onload = (e) => {
    elements.imagePreview.innerHTML = `<img src="${e.target.result}" alt="Uploaded image preview">`;
  };
  reader.readAsDataURL(file);
}

async function preprocessImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          const threshold = 140;
          const value = gray < threshold ? 0 : 255;

          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result.split(',')[1];
            resolve({ base64, mimeType: 'image/png' });
          };
          reader.readAsDataURL(blob);
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function processImage() {
  if (!selectedFile) return;

  elements.processBtn.disabled = true;
  elements.processingSection.style.display = 'block';
  elements.dataSection.style.display = 'none';

  try {
    const { base64, mimeType } = await preprocessImage(selectedFile);

    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType: mimeType
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'OCR request failed');
    }

    const result = await response.json();

    if (result.partners && result.partners.length > 0) {
      state.partners = result.partners.map(p => ({
        id: `p${nextPartnerId++}`,
        partnerName: p.partnerName || '',
        partnerNumber: p.partnerNumber || '',
        tippableHours: p.tippableHours || 0,
        tipAmount: 0,
        denomination: null
      }));
    } else {
      state.partners = [];
      alert('No partner data found in the image. You can add partners manually.');
    }

    renderPartnersTable();
    elements.dataSection.style.display = 'block';

  } catch (error) {
    console.error('Processing error:', error);
    alert(`Error processing image: ${error.message}`);
  } finally {
    elements.processingSection.style.display = 'none';
    elements.processBtn.disabled = false;
  }
}

function renderPartnersTable() {
  elements.partnersTableBody.innerHTML = '';

  state.partners.forEach((partner) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="editable-cell">
        <input type="text" value="${escapeHtml(partner.partnerName)}" data-id="${partner.id}" data-field="partnerName">
      </td>
      <td class="editable-cell">
        <input type="text" value="${escapeHtml(partner.partnerNumber)}" data-id="${partner.id}" data-field="partnerNumber">
      </td>
      <td class="editable-cell">
        <input type="number" step="0.5" min="0" value="${partner.tippableHours}" data-id="${partner.id}" data-field="tippableHours">
      </td>
      <td>
        <button class="delete-btn" data-id="${partner.id}">Delete</button>
      </td>
    `;
    elements.partnersTableBody.appendChild(row);
  });

  elements.partnersTableBody.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', handlePartnerDataChange);
  });

  elements.partnersTableBody.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeletePartner);
  });
}

function handlePartnerDataChange(event) {
  const id = event.target.dataset.id;
  const field = event.target.dataset.field;
  const value = event.target.value;

  const partner = state.partners.find(p => p.id === id);
  if (!partner) return;

  if (field === 'tippableHours') {
    partner[field] = parseFloat(value) || 0;
  } else {
    partner[field] = value;
  }
}

function handleDeletePartner(event) {
  const id = event.target.dataset.id;
  state.partners = state.partners.filter(p => p.id !== id);
  renderPartnersTable();
}

function addPartnerRow() {
  state.partners.push({
    id: `p${nextPartnerId++}`,
    partnerName: '',
    partnerNumber: '',
    tippableHours: 0,
    tipAmount: 0,
    denomination: null
  });
  renderPartnersTable();
}

function calculateTips() {
  state.totalTips = parseFloat(elements.totalTipsInput.value) || 0;
  state.cashInventory.twenties = parseInt(elements.twentiesInput.value) || 0;
  state.cashInventory.tens = parseInt(elements.tensInput.value) || 0;
  state.cashInventory.fives = parseInt(elements.fivesInput.value) || 0;
  state.cashInventory.ones = parseInt(elements.onesInput.value) || 0;

  state.totalHours = state.partners.reduce((sum, p) => sum + p.tippableHours, 0);

  if (state.totalHours === 0) {
    alert('Total tippable hours is zero. Cannot calculate tips.');
    return;
  }

  let tipSum = 0;
  state.partners.forEach((partner, index) => {
    const ratio = partner.tippableHours / state.totalHours;
    const rawTip = ratio * state.totalTips;
    partner.tipAmount = Math.round(rawTip * 100) / 100;
    tipSum += partner.tipAmount;
  });

  const difference = state.totalTips - tipSum;
  if (difference !== 0 && state.partners.length > 0) {
    state.partners[state.partners.length - 1].tipAmount += difference;
    state.partners[state.partners.length - 1].tipAmount = Math.round(state.partners[state.partners.length - 1].tipAmount * 100) / 100;
  }

  distributeDenominations();
  renderResults();
}

function distributeDenominations() {
  const available = { ...state.cashInventory };

  let hasInsufficientBills = false;

  state.partners.forEach(partner => {
    let remaining = partner.tipAmount;

    const use20 = Math.min(Math.floor(remaining / 20), available.twenties);
    remaining -= use20 * 20;
    available.twenties -= use20;

    const use10 = Math.min(Math.floor(remaining / 10), available.tens);
    remaining -= use10 * 10;
    available.tens -= use10;

    const use5 = Math.min(Math.floor(remaining / 5), available.fives);
    remaining -= use5 * 5;
    available.fives -= use5;

    const use1 = Math.min(Math.round(remaining), available.ones);
    remaining -= use1 * 1;
    available.ones -= use1;

    if (remaining > 0.5) {
      hasInsufficientBills = true;
    }

    partner.denomination = {
      total: partner.tipAmount,
      twenties: use20,
      tens: use10,
      fives: use5,
      ones: use1
    };
  });

  if (hasInsufficientBills) {
    elements.warningMessage.textContent = 'Warning: Not enough bills to perfectly satisfy all partners. Some partners may receive less than their calculated amount.';
    elements.warningMessage.style.display = 'block';
  } else {
    elements.warningMessage.style.display = 'none';
  }
}

function renderResults() {
  const hourlyRate = state.totalHours > 0 ? state.totalTips / state.totalHours : 0;

  elements.summaryTotalHours.textContent = state.totalHours.toFixed(2);
  elements.summaryHourlyRate.textContent = `$${hourlyRate.toFixed(2)}`;

  const distributed = state.partners.reduce((sum, p) => {
    const d = p.denomination;
    return sum + (d.twenties * 20 + d.tens * 10 + d.fives * 5 + d.ones * 1);
  }, 0);
  elements.summaryDistributed.textContent = `$${distributed.toFixed(2)}`;

  elements.formulaTotalTips.textContent = `$${state.totalTips.toFixed(2)}`;
  elements.formulaTotalHours.textContent = state.totalHours.toFixed(2);
  elements.formulaRate.textContent = `$${hourlyRate.toFixed(2)}`;

  const billCounts = {
    twenties: 0,
    tens: 0,
    fives: 0,
    ones: 0
  };

  state.partners.forEach(p => {
    billCounts.twenties += p.denomination.twenties;
    billCounts.tens += p.denomination.tens;
    billCounts.fives += p.denomination.fives;
    billCounts.ones += p.denomination.ones;
  });

  elements.billsNeeded.innerHTML = '';
  if (billCounts.twenties > 0) {
    elements.billsNeeded.innerHTML += `<span class="bill-badge bill-20">${billCounts.twenties} × $20</span>`;
  }
  if (billCounts.tens > 0) {
    elements.billsNeeded.innerHTML += `<span class="bill-badge bill-10">${billCounts.tens} × $10</span>`;
  }
  if (billCounts.fives > 0) {
    elements.billsNeeded.innerHTML += `<span class="bill-badge bill-5">${billCounts.fives} × $5</span>`;
  }
  if (billCounts.ones > 0) {
    elements.billsNeeded.innerHTML += `<span class="bill-badge bill-1">${billCounts.ones} × $1</span>`;
  }

  elements.partnerCardsContainer.innerHTML = '';

  state.partners.forEach(partner => {
    const card = document.createElement('div');
    card.className = 'partner-card';

    const billsHtml = [];
    if (partner.denomination.twenties > 0) {
      billsHtml.push(`<span class="partner-bill bill-badge bill-20">${partner.denomination.twenties}×$20</span>`);
    }
    if (partner.denomination.tens > 0) {
      billsHtml.push(`<span class="partner-bill bill-badge bill-10">${partner.denomination.tens}×$10</span>`);
    }
    if (partner.denomination.fives > 0) {
      billsHtml.push(`<span class="partner-bill bill-badge bill-5">${partner.denomination.fives}×$5</span>`);
    }
    if (partner.denomination.ones > 0) {
      billsHtml.push(`<span class="partner-bill bill-badge bill-1">${partner.denomination.ones}×$1</span>`);
    }

    card.innerHTML = `
      <div class="partner-header">
        <div class="partner-name">${escapeHtml(partner.partnerName)}</div>
        <div class="partner-amount">$${partner.tipAmount.toFixed(0)}</div>
      </div>
      <div class="partner-hours">${partner.tippableHours.toFixed(2)} hours</div>
      <div class="partner-calculation">
        ${partner.tippableHours.toFixed(2)} × $${hourlyRate.toFixed(2)} = $${(partner.tippableHours * hourlyRate).toFixed(2)} → $${partner.tipAmount.toFixed(0)}
      </div>
      <div class="partner-bills">
        ${billsHtml.join('')}
      </div>
    `;

    elements.partnerCardsContainer.appendChild(card);
  });

  elements.resultsSection.style.display = 'block';
}

function exportToCsv() {
  const headers = ['Partner Name', 'Partner Number', 'Tippable Hours', 'Tip Amount', '20s', '10s', '5s', '1s'];
  const rows = state.partners.map(p => [
    escapeCSV(p.partnerName),
    escapeCSV(p.partnerNumber),
    p.tippableHours.toFixed(1),
    p.tipAmount.toFixed(2),
    p.denomination.twenties,
    p.denomination.tens,
    p.denomination.fives,
    p.denomination.ones
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `barista-tips-${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeCSV(text) {
  const str = String(text);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
