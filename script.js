

/* ==========================================================================
   BELISIO EXPRESS - COMMAND CENTER v3.0 (GESTÃO INTEGRADA)
   ========================================================================== */

let db = [];
let charts = {};

// 1. Configurações de URLs (Google Sheets)
const urlPrincipal = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjNb11bcijL_wpJ8JM6KB8tDih5-34uXxJFyFVC7_pF8PxtoB-_ekFPVpPP44BoodHfavnPIuHi6Mt/pub?output=csv';
const urlCustosFixos = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjNb11bcijL_wpJ8JM6KB8tDih5-34uXxJFyFVC7_pF8PxtoB-_ekFPVpPP44BoodHfavnPIuHi6Mt/pub?gid=1196906774&single=true&output=csv';

// 2. Tabela de Referência ANTT
const tabelaANTT = { 2: 4.85, 3: 5.92, 5: 7.40, 6: 8.65, 7: 9.20, 9: 11.50 };

// 3. FUNÇÃO DE CONVERSÃO DE DATA (CORREÇÃO DO FILTRO)
function parseDate(dateStr) {
    if (!dateStr) return null;
    let s = dateStr.toString().toLowerCase().trim();
    
    // Meses para formato "01 dez"
    const meses = {
        'jan': 0, 'fev': 1, 'mar': 2, 'abr': 3, 'mai': 4, 'jun': 5,
        'jul': 6, 'ago': 7, 'set': 8, 'out': 9, 'nov': 10, 'dez': 11
    };

    let d;
    // Caso 1: Formato Input HTML (AAAA-MM-DD)
    if (s.includes('-') && s.split('-')[0].length === 4) {
        d = new Date(s + 'T00:00:00');
    } 
    // Caso 2: Formato Planilha (DD/MM/AAAA)
    else if (s.includes('/')) {
        const p = s.split('/');
        d = new Date(p[2] || 2025, p[1] - 1, p[0], 0, 0, 0);
    }
    // Caso 3: Formato Planilha (01 dez)
    else if (s.split(' ').length >= 2) {
        const p = s.split(' ');
        const dia = parseInt(p[0]);
        const mesTexto = p[1].substring(0, 3);
        const mes = meses[mesTexto];
        if (!isNaN(dia) && mes !== undefined) {
            d = new Date(2025, mes, dia, 0, 0, 0);
        }
    }

    return (d instanceof Date && !isNaN(d)) ? d : null;
}

// 4. Inicialização e Tema
const themeToggle = document.getElementById('themeToggle');

function updateTheme() {
    const isLight = document.body.classList.contains('light-mode');
    const color = isLight ? '#000000' : '#c9d1d9';
    const grid = isLight ? '#f0f0f0' : '#30363d';

    if (window.Chart) {
        Chart.defaults.color = color;
        Chart.defaults.scale.grid.color = grid;
    }
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    if (db.length > 0) applyFilters();
}

if (themeToggle) {
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('light-mode');
        updateTheme();
    });
}

// 5. Carregamento de Dados
async function loadAutoData() {
    try {
        const response = await fetch(urlPrincipal);
        if (!response.ok) throw new Error("Erro ao ler planilha principal.");
        const csvText = await response.text();
        const workbook = XLSX.read(csvText, { type: 'string' }); 
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: 0 });
        
        db = json.filter(row => row.DATA || row.MOTORISTA).map(row => {
            let r = {};
            for (let key in row) {
                let normalizedKey = key.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                r[normalizedKey] = row[key];
            }
            return r;
        });
        populateFilters();
        applyFilters();
    } catch (error) {
        console.error("Erro na conexão principal:", error);
    }
}

async function loadCustosFixos() {
    try {
        const response = await fetch(urlCustosFixos);
        const csvText = await response.text();
        const workbook = XLSX.read(csvText, { type: 'string' });
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const tbody = document.getElementById('tableCustosFixos');
        const totalEl = document.getElementById('totalCustosFixos');
        if (!tbody) return;
        let total = 0;
        tbody.innerHTML = "";
        data.forEach(row => {
            const categoria = row.CATEGORIA || row.categoria || 'N/A';
            const descricao = row.DESCRICAO || row.DESCRIÇÃO || row.descricao || '-';
            const valor = parseFloat(row.VALOR || row.valor || 0);
            const vencimento = row.VENCIMENTO || row.vencimento || '-';
            total += valor;
            tbody.innerHTML += `<tr>
                <td><span class="badge bg-secondary">${categoria}</span></td>
                <td>${descricao}</td>
                <td class="fw-bold">${formatBRL(valor)}</td>
                <td>Dia ${vencimento}</td>
                <td><span class="badge bg-success">Programado</span></td>
            </tr>`;
        });
        if (totalEl) totalEl.innerText = formatBRL(total);
    } catch (e) { console.error("Erro custos fixos:", e); }
}

// 6. SISTEMA DE FILTROS (CORRIGIDO)
function populateFilters() {
    const getList = (f) => [...new Set(db.map(i => i[f]))].sort();
    const fill = (id, list) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '<option value="all">Todos</option>';
        list.forEach(i => { if(i) el.innerHTML += `<option value="${i}">${i}</option>`; });
    };
    fill('fMotorista', getList('motorista'));
    fill('fPlaca', getList('placa'));
}

function applyFilters() {
    const m = document.getElementById('fMotorista')?.value || 'all';
    const p = document.getElementById('fPlaca')?.value || 'all';
    const dStartStr = document.getElementById('dateStart')?.value;
    const dEndStr = document.getElementById('dateEnd')?.value;

    const dStart = parseDate(dStartStr);
    const dEnd = parseDate(dEndStr);

    const filtered = db.filter(i => {
        const matchM = (m === 'all' || i.motorista == m);
        const matchP = (p === 'all' || i.placa == p);
        
        let matchDate = true;
        const rowDate = parseDate(i.data);

        if (dStart || dEnd) {
            if (rowDate) {
                if (dStart && rowDate < dStart) matchDate = false;
                if (dEnd && rowDate > dEnd) matchDate = false;
            } else {
                matchDate = false; 
            }
        }
        return matchM && matchP && matchDate;
    });

    render(filtered);
    renderComissoes(filtered); 
    renderLogistica(filtered);
    updateKmChart(filtered);
}

// 7. Renderização Principal
function render(data) {
    let t = { fat: 0, die: 0, com: 0, luc: 0, man: 0 };
    const tbody = document.getElementById('tableBody');
    if(!tbody) return;
    tbody.innerHTML = "";

    data.forEach(i => {
        const f = parseFloat(i.frete || 0);
        const d = parseFloat(i.diesel || 0);
        const c = parseFloat(i.comissoes || 0);
        const m = parseFloat(i.manutencao || 0);
        const lucro = f - d - c - m;
        const margem = f > 0 ? (lucro / f) * 100 : 0;
        t.fat += f; t.die += d; t.com += c; t.luc += lucro; t.man += m;
        const corMargem = margem >= 18 ? '#39d353' : (margem >= 10 ? '#f1c40f' : '#f85149');

        tbody.innerHTML += `<tr>
            <td>${i.data || '-'}</td>
            <td>${i.motorista || '-'}</td>
            <td>${i.placa || '-'}</td>
            <td>${formatBRL(f)}</td>
            <td>${formatBRL(d)}</td>
            <td>${formatBRL(m)}</td>
            <td>${formatBRL(c)}</td>
            <td style="color:#39d353; font-weight:bold">${formatBRL(lucro)}</td>
            <td style="color: ${corMargem}; font-weight:bold">${margem.toFixed(1)}%</td>
        </tr>`;
    });

    document.getElementById('kpi-fat').innerText = formatBRL(t.fat);
    document.getElementById('kpi-die').innerText = formatBRL(t.die);
    document.getElementById('kpi-luc').innerText = formatBRL(t.luc);
    
    const margemGeral = (t.fat > 0 ? (t.luc / t.fat)*100 : 0);
    const mGeralEl = document.getElementById('kpi-mar');
    if(mGeralEl) {
        mGeralEl.innerText = margemGeral.toFixed(1) + '%';
        mGeralEl.style.color = margemGeral >= 15 ? '#39d353' : '#f85149';
    }
    
    updateCharts(data, t);
    updateMaintenance();
    runFinancialAI(t, margemGeral);
}

// 8. Gráficos (Evolução com Ordenação de Data Corrigida)
function updateCharts(data, t) {
    const isLight = document.body.classList.contains('light-mode');
    const labelColor = isLight ? '#000000' : '#c9d1d9';
    
    const resumoPorData = {};
    data.forEach(i => {
        let dataKey = i.data || '00/00';
        if (!resumoPorData[dataKey]) resumoPorData[dataKey] = { frete: 0, custos: 0 };
        resumoPorData[dataKey].frete += parseFloat(i.frete || 0);
        resumoPorData[dataKey].custos += (parseFloat(i.diesel || 0) + parseFloat(i.manutencao || 0));
    });

    const datasOrdenadas = Object.keys(resumoPorData).sort((a, b) => parseDate(a) - parseDate(b));

    if(charts.evol) charts.evol.destroy();
    const ctxEvol = document.getElementById('chartEvol');
    if(ctxEvol) {
        charts.evol = new Chart(ctxEvol, {
            type: 'line',
            data: {
                labels: datasOrdenadas,
                datasets: [
                    { label: 'Frete', data: datasOrdenadas.map(d => resumoPorData[d].frete), borderColor: '#58a6ff', tension: 0.3 },
                    { label: 'Custos', data: datasOrdenadas.map(d => resumoPorData[d].custos), borderColor: '#f85149', tension: 0.3 }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { ticks: { color: labelColor }, grid: { color: isLight ? '#f0f0f0' : '#30363d' } },
                    y: { ticks: { color: labelColor }, grid: { color: isLight ? '#f0f0f0' : '#30363d' } }
                },
                plugins: { legend: { labels: { color: labelColor } } }
            }
        });
    }

    if(charts.cost) charts.cost.destroy();
    const ctxCost = document.getElementById('chartCosts');
    if(ctxCost) {
        charts.cost = new Chart(ctxCost, {
            type: 'doughnut',
            data: {
                labels: ['Diesel', 'Comissão', 'Manut.', 'Líquido'],
                datasets: [{ 
                    data: [t.die, t.com, t.man, Math.max(0, t.luc)], 
                    backgroundColor: ['#f1c40f', '#a371f7', '#f85149', '#39d353']
                }]
            },
            options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: labelColor } } }, cutout: '70%' }
        });
    }
}

// 9. IA e Outros
function runFinancialAI(totais, margem) {
    const aiContainer = document.getElementById('status-alerts');
    if(!aiContainer) return;
    let status = "", recomendacao = "", cor = "";
    if (margem >= 20) { status = "SAÚDE EXCELENTE 🚀"; recomendacao = "Operação altamente lucrativa."; cor = "#39d353"; }
    else if (margem >= 12) { status = "SAÚDE ESTÁVEL ✅"; recomendacao = "Operação dentro da média."; cor = "#58a6ff"; }
    else { status = "ALERTA CRÍTICO ⚠️"; recomendacao = "Margem abaixo de 12%."; cor = "#f85149"; }
    aiContainer.innerHTML = `<div style="border-left: 4px solid ${cor}; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 4px;">
        <div style="font-weight: bold; color: ${cor}; font-size: 0.9rem;">DIAGNÓSTICO IA: ${status}</div>
        <div style="font-size: 0.8rem; color: #8b949e;">${recomendacao}</div>
    </div>`;
}

function renderLogistica(data) {
    const tbody = document.getElementById('logisticaTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";
    data.forEach(i => {
        const km = parseFloat(i.km || 0);
        const freteReal = parseFloat(i.frete || 0);
        const valorMinimoANTT = km * (tabelaANTT[parseInt(i.eixos) || 3] || 6.00);
        const corStatus = freteReal >= valorMinimoANTT ? "#39d353" : "#f85149";
        tbody.innerHTML += `<tr>
            <td><span class="badge bg-secondary">${(i.placa || "").toUpperCase()}</span></td>
            <td>${i.motorista || '-'}</td>
            <td>${i.origem || '?'} → ${i.destino || '?'}</td>
            <td><b>${km} KM</b></td>
            <td><div style="font-weight:bold; color: ${corStatus}">${formatBRL(freteReal)}</div></td>
            <td><span class="badge" style="background-color: ${corStatus}">${freteReal >= valorMinimoANTT ? '✅ OK' : '⚠️ BAIXO'}</span></td>
        </tr>`;
    });
}

function renderComissoes(data) {
    const coms = {};
    data.forEach(i => {
        const mot = i.motorista || 'Não Identificado';
        if (!coms[mot]) coms[mot] = { viagens: 0, frete: 0, valor: 0, diesel: 0 };
        coms[mot].viagens++; 
        coms[mot].frete += parseFloat(i.frete || 0); 
        coms[mot].valor += parseFloat(i.comissoes || 0); 
        coms[mot].diesel += parseFloat(i.diesel || 0);
    });
    const tbody = document.getElementById('comissaoTableBody');
    if(tbody) {
        tbody.innerHTML = "";
        Object.entries(coms).forEach(([nome, info]) => {
            tbody.innerHTML += `<tr><td><b>${nome}</b></td><td>${info.viagens}</td><td>${formatBRL(info.frete)}</td><td style="color:var(--warning)">${formatBRL(info.diesel)}</td><td style="color:var(--accent); font-weight:bold">${formatBRL(info.valor)}</td></tr>`;
        });
    }
}

function updateKmChart(data) {
    const ctx = document.getElementById('chartKmPlaca');
    if(!ctx) return;
    const labelColor = document.body.classList.contains('light-mode') ? '#000000' : '#c9d1d9';
    const kmPorPlaca = {};
    data.forEach(i => { 
        const placa = (i.placa || 'S/P').toUpperCase();
        kmPorPlaca[placa] = (kmPorPlaca[placa] || 0) + parseFloat(i.km || 0); 
    });
    if(charts.kmPlaca) charts.kmPlaca.destroy();
    charts.kmPlaca = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(kmPorPlaca),
            datasets: [{ data: Object.values(kmPorPlaca), backgroundColor: ['#58a6ff', '#39d353', '#f1c40f', '#f85149'] }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { color: labelColor } } }, cutout: '70%' }
    });
}

function updateMaintenance() {
    const plates = {};
    const today = new Date();
    db.forEach(i => {
        if(parseFloat(i.manutencao) > 0) {
            const d = parseDate(i.data);
            if(d && (!plates[i.placa] || d > plates[i.placa])) plates[i.placa] = d;
        }
    });
    const list = document.getElementById('maint-list');
    if(list) {
        list.innerHTML = "";
        Object.entries(plates).forEach(([placa, data]) => {
            const diffDays = Math.floor((today - data) / (1000 * 60 * 60 * 24));
            list.innerHTML += `<div class="ranking-item"><span>${placa}</span> <span class="badge ${diffDays > 30 ? 'bg-danger' : 'bg-success'}">${diffDays} dias</span></div>`;
        });
    }
}

function formatBRL(v) { return (v || 0).toLocaleString('pt-br', { style: 'currency', currency: 'BRL' }); }

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') { document.body.classList.add('light-mode'); if(themeToggle) themeToggle.checked = true; }
    updateTheme();
    loadAutoData();
    loadCustosFixos();
});
