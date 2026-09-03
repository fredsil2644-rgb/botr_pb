const PDF_URL = './catalogo-plastiborracha.pdf';
const catalog = document.querySelector('#catalog');
const search = document.querySelector('#search');
const sort = document.querySelector('#sort');
const status = document.querySelector('#status');
const count = document.querySelector('#count');
const empty = document.querySelector('#empty');
const filterButton = document.querySelector('#filter-button');
const filterDialog = document.querySelector('#filter-dialog');
const filterForm = document.querySelector('#filter-form');
let records = [];
let selectedFamilies = [];
const familiesWithoutImages = new Set(['110', '115', '123', '196', '269', '280', '281', '282', '424', '448']);

function dimensions(text) {
  const matches = text.match(/\b\d{1,4}(?:[,.]\d{1,2})?\s*(?:x|×|X)\s*\d{1,4}(?:[,.]\d{1,2})?(?:\s*(?:x|×|X)\s*\d{1,4}(?:[,.]\d{1,2})?)?\s*(?:mm|cm)?\b/gi);
  if (matches) return matches.slice(0, 3).map(value => value.replace(/,/g, '.')).join(' · ');
  const values = text.replace(/\b\d{5}(?:-[A-Z])?\b/g, '').match(/\b\d{1,3}(?:[,.]\d{1,2})?\b/g);
  return values?.slice(0, 3).map(value => value.replace(/,/g, '.')).join(' × ') || 'Consultar ficha';
}
function referenceItems(items, page) {
  const references = items.filter(item => isReference(item.str.trim()));
  return references.length ? references : [{ str: `PÁGINA ${String(page).padStart(2, '0')}`, transform: [1, 0, 0, 1, 50, 300] }];
}
function isReference(value) {
  return /^\d{5}(?:-[A-Z])?$|^\d{5}[A-Z]$/.test(value);
}
function title(text, page) {
  const lines = text.split(/\n+/).map(line => line.trim()).filter(line => line.length > 3 && !/^\d+$/.test(line));
  const candidate = lines.find(line => !/^(plastiborracha|plasti figures|www\.|www\.)/i.test(line) && line.length < 70);
  return candidate || `Figura de catálogo · página ${page}`;
}
function cropPage(canvas, ref, viewport) {
  const scale = viewport.scale;
  const x = ref.transform[4] * scale;
  const y = canvas.height - (ref.transform[5] * scale);
  const width = Math.min(300 * scale, canvas.width);
  const height = Math.min(250 * scale, canvas.height);
  const sourceX = Math.max(0, Math.min(canvas.width - width, x - width / 2));
  const sourceY = Math.max(0, Math.min(canvas.height - height, y - height / 2));
  const crop = document.createElement('canvas');
  crop.width = width; crop.height = height;
  crop.getContext('2d').drawImage(canvas, sourceX, sourceY, width, height, 0, 0, width, height);
  return crop.toDataURL('image/jpeg', .88);
}
function itemTableText(items, ref) {
  const start = items.indexOf(ref);
  const next = items.findIndex((item, index) => index > start && isReference(item.str.trim()));
  return items.slice(start, next === -1 ? items.length : next).map(item => item.str.trim()).filter(Boolean).join(' · ');
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
}
function numericValue(value, emptyIsInfinity = true) {
  const number = Number.parseFloat(value?.replace(',', '.'));
  return Number.isNaN(number) ? (emptyIsInfinity ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY) : number;
}
function rangeNumber(value, fallback) {
  const number = Number.parseFloat(value?.replace(',', '.'));
  return Number.isNaN(number) ? fallback : number;
}
function dimensionParts(text) {
  const values = text.replace(/\b\d{5}(?:-[A-Z])?\b/g, '').match(/\b\d{1,3}(?:[,.]\d{1,2})?\b/g) || [];
  return values.slice(0, 3).map(value => value.replace(',', '.'));
}
function familyMarkup(family) {
  const safeFamily = escapeHtml(family);
  if (!/^\d{3}$/.test(family) || familiesWithoutImages.has(family)) return safeFamily;
  return `<span class="family-hover">${safeFamily}<span class="family-preview"><img src="./img/familias/${safeFamily}.jpg" alt="Imagem da família ${safeFamily}" loading="lazy"></span></span>`;
}
function familyFor(items, ref) {
  const start = items.indexOf(ref);
  const before = items.slice(0, start);
  const headerIndex = before.map(item => item.str.trim().toUpperCase()).lastIndexOf('H');
  const candidate = items.slice(headerIndex + 1, start).map(item => item.str.trim()).find(value => /^\d{2,4}$/.test(value));
  return candidate || 'Sem família';
}
function render() {
  const term = search.value.trim().toLowerCase();
  const reference = search.value.trim().toLowerCase();
  const rangeFilters = ['exterior', 'interior', 'height'].map(name => [...document.querySelectorAll(`[data-filter="${name}"] .range-list .range-fields`)].map(row => ({ min: rangeNumber(row.querySelector('.filter-min').value, Number.NEGATIVE_INFINITY), max: rangeNumber(row.querySelector('.filter-max').value, Number.POSITIVE_INFINITY) })).filter(range => Number.isFinite(range.min) || Number.isFinite(range.max)));
  const filtered = records.filter(item => {
    const matchesText = `${item.reference} ${item.family} ${item.dimensions}`.toLowerCase().includes(term) && (!reference || item.reference.toLowerCase().includes(reference));
    const matchesTextFilters = !selectedFamilies.length || selectedFamilies.includes(item.family);
    const matchesRanges = rangeFilters.every((ranges, index) => !ranges.length || ranges.some(range => { const value = numericValue(item.measurements[index]); return value >= range.min && value <= range.max; }));
    const matchesFields = matchesTextFilters && matchesRanges;
    return matchesText && matchesFields;
  });
  const sorters = {
    'reference-asc': (a, b) => a.reference.localeCompare(b.reference),
    'reference-desc': (a, b) => b.reference.localeCompare(a.reference),
    'family-asc': (a, b) => a.family.localeCompare(b.family),
    'family-desc': (a, b) => b.family.localeCompare(a.family),
    'exterior-asc': (a, b) => numericValue(a.measurements[0]) - numericValue(b.measurements[0]),
    'exterior-desc': (a, b) => numericValue(b.measurements[0]) - numericValue(a.measurements[0]),
    'interior-asc': (a, b) => numericValue(a.measurements[1]) - numericValue(b.measurements[1]),
    'interior-desc': (a, b) => numericValue(b.measurements[1]) - numericValue(a.measurements[1]),
    'height-asc': (a, b) => numericValue(a.measurements[2]) - numericValue(b.measurements[2]),
    'height-desc': (a, b) => numericValue(b.measurements[2]) - numericValue(a.measurements[2])
  };
  filtered.sort(sorters[sort.value] || ((a, b) => a.page - b.page));
  count.textContent = `${filtered.length} ${filtered.length === 1 ? 'registo' : 'registos'}`;
  empty.hidden = filtered.length !== 0;
  catalog.innerHTML = `<table><thead><tr><th>Referência</th><th>Família</th><th>Diâmetro exterior</th><th>Diâmetro interior</th><th>Altura</th></tr></thead><tbody>${filtered.map(item => `<tr><td data-label="Referência"><strong>${escapeHtml(item.reference)}</strong></td><td data-label="Família">${familyMarkup(item.family)}</td><td data-label="Diâmetro exterior">${escapeHtml(item.measurements[0] || '—')}</td><td data-label="Diâmetro interior">${escapeHtml(item.measurements[1] || '—')}</td><td data-label="Altura">${escapeHtml(item.measurements[2] || '—')}</td></tr>`).join('')}</tbody></table>`;
}

async function loadCatalog() {
  try {
    records = [];
    catalog.innerHTML = '';
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
    const pdf = await pdfjs.getDocument(PDF_URL).promise;
    status.textContent = `${pdf.numPages} páginas do catálogo carregadas`;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items;
      const text = items.map(item => item.str).join('\n');
      referenceItems(items, pageNumber).forEach(itemReference => {
        const sourceText = itemTableText(items, itemReference) || text.replace(/\s+/g, ' ').trim();
        const itemReferenceValue = itemReference.str.trim();
        records.push({ page: pageNumber, reference: itemReferenceValue, family: familyFor(items, itemReference), title: `Artigo ${itemReferenceValue}`, dimensions: dimensions(sourceText), measurements: dimensionParts(sourceText), sourceText });
      });
      count.textContent = `${records.length} referências · ${pageNumber} de ${pdf.numPages} páginas`;
      render();
    }
    renderFamilyOptions();
    renderSelectedFamilies();
    status.textContent = 'Catálogo pronto para consulta';
  } catch (error) {
    status.textContent = 'Não foi possível ler o PDF automaticamente';
    catalog.innerHTML = `<div class="empty" style="display:block;grid-column:1/-1">Abra o catálogo original para consultar as páginas. (${error.message})</div>`;
  }
}
search.addEventListener('input', render);
sort.addEventListener('change', render);
filterButton.addEventListener('click', () => { renderFamilyOptions(); renderSelectedFamilies(); filterDialog.showModal(); filterButton.setAttribute('aria-expanded', 'true'); });
document.querySelector('#close-filter').addEventListener('click', () => { filterDialog.close(); filterButton.setAttribute('aria-expanded', 'false'); });
filterDialog.addEventListener('close', () => filterButton.setAttribute('aria-expanded', 'false'));
filterForm.addEventListener('submit', event => { event.preventDefault(); filterDialog.close(); filterButton.setAttribute('aria-expanded', 'false'); render(); });
const familySearch = document.querySelector('#family-search');
const familyOptions = document.querySelector('#family-options');
const selectedFamilyList = document.querySelector('#selected-families');
function renderFamilyOptions() {
  const term = familySearch.value.trim().toLowerCase();
  const families = [...new Set(records.map(item => item.family))].filter(family => family.toLowerCase().includes(term));
  familyOptions.innerHTML = families.map(family => `<button type="button" class="family-option${selectedFamilies.includes(family) ? ' selected' : ''}" data-family="${escapeHtml(family)}">${escapeHtml(family)}</button>`).join('');
  familyOptions.querySelectorAll('.family-option').forEach(button => button.addEventListener('click', () => { const family = button.dataset.family; selectedFamilies = selectedFamilies.includes(family) ? selectedFamilies.filter(value => value !== family) : [...selectedFamilies, family]; renderFamilyOptions(); renderSelectedFamilies(); }));
}
function renderSelectedFamilies() {
  selectedFamilyList.innerHTML = selectedFamilies.map(family => `<button type="button" class="family-chip" data-family="${escapeHtml(family)}">${escapeHtml(family)} ×</button>`).join('');
  selectedFamilyList.querySelectorAll('.family-chip').forEach(button => button.addEventListener('click', () => { selectedFamilies = selectedFamilies.filter(value => value !== button.dataset.family); renderFamilyOptions(); renderSelectedFamilies(); }));
}
familySearch.addEventListener('input', renderFamilyOptions);
document.querySelectorAll('.add-filter').forEach(button => button.addEventListener('click', () => {
  const list = button.closest('.filter-group').querySelector('.range-list');
  const row = list.querySelector('.range-fields').cloneNode(true);
  row.querySelectorAll('input').forEach(input => { input.value = ''; });
  row.insertAdjacentHTML('beforeend', '<button type="button" class="remove-range" aria-label="Remover intervalo">×</button>');
  list.appendChild(row);
  row.querySelector('.remove-range').addEventListener('click', () => row.remove());
}));
document.querySelector('#clear-filters').addEventListener('click', () => { selectedFamilies = []; document.querySelectorAll('.filter-min, .filter-max').forEach(input => { input.value = ''; }); document.querySelectorAll('.range-list').forEach(list => { list.querySelectorAll('.range-fields:not(:first-child)').forEach(row => row.remove()); }); renderFamilyOptions(); renderSelectedFamilies(); render(); });
loadCatalog();
