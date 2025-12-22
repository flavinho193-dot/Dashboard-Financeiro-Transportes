let db = [];
let charts = {};

// 1. Função para carregar os dados diretamente do Google Sheets
async function loadAutoData() {
    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjNb11bcijL_wpJ8JM6KB8tDih5-34uXxJFyFVC7_pF8PxtoB-_ekFPVpPP44BoodHfavnPIuHi6Mt/pub?output=csv'; 
    
    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error("Não foi possível ler a planilha do Google.");
        
        const csvText = await response.text();
        
        // Lê o CSV do Google Sheets
        const workbook = XLSX.read(csvText, { type: 'string' }); 
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: 0 });
        
        // Filtra linhas vazias e normaliza as colunas (remove acentos e espaços)
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
        console.log("Dashboard Belisio Express conectado!");
    } catch (error) {
        console.error("Erro na conexão:", error);
    }
}

// Inicia o sistema ao abrir a página
window.onload = loadAutoData;

// 2. Preencher os filtros de Motorista e Placa
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

// 3. Aplicar Filtros (Data, Motorista e Placa)
function applyFilters() {
    const m = document.getElementById('fMotorista').value;
    const p = document.getElementById('fPlaca').value;
    const dStart = document.getElementById('dateStart').value;
    const dEnd = document.getElementById('dateEnd').value;

    const filtered = db.filter(i => {
        const matchM = (m === 'all' || i.motorista == m);
        const matchP = (p === 'all' || i.placa == p);
        let matchDate = true;
        if (dStart || dEnd) {
            const rowDate = new Date(i.data);
            if (dStart && rowDate < new Date(dStart)) matchDate = false;
            if (dEnd && rowDate > new Date(dEnd)) matchDate = false;
        }
        return matchM && matchP && matchDate;
    });

    render(filtered);
    renderComissoes(filtered);
    renderGastoDiesel(filtered); // Chamada integrada aqui
}

// 4. Renderizar Tabela Principal e KPIs
function render(data) {
    let t = { fat: 0, die: 0, com: 0, luc: 0, man: 0 };
    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = "";
    let criticalCount = 0;

    data.forEach(i => {
        const f = parseFloat(i.frete || 0);
        const d = parseFloat(i.diesel || 0);
        const c = parseFloat(i.comissoes || 0);
        const m = parseFloat(i.manutencao || 0);
        
        const lucro = f - d - c - m;
        const margem = f > 0 ? (lucro / f) * 100 : 0;
        const percDiesel = f > 0 ? (d / f) * 100 : 0;
        
        const isCritical = (percDiesel > 45 || m > lucro);
        if(isCritical) criticalCount++;

        t.fat += f; t.die += d; t.com += c; t.luc += lucro; t.man += m;

        tbody.innerHTML += `
            <tr class="${isCritical ? 'row-critical' : ''}">
                <td>${i.data || '-'}</td>
                <td>${i.motorista || '-'}</td>
                <td>${i.placa || '-'}</td>
                <td>${i.origem || '-'}</td>
                <td>${i.destino || '-'}</td>
                <td>${formatBRL(f)}</td>
                <td>${formatBRL(d)}</td>
                <td>${formatBRL(m)}</td>
                <td>${formatBRL(c)}</td>
                <td style="color:var(--success)">${formatBRL(lucro)}</td>
                <td class="${margem >= 15 ? 'pos-margem' : 'neg-margem'}">
                    ${margem.toFixed(1)}% ${isCritical ? '⚠️' : ''}
                </td>
            </tr>`;
    });

    document.getElementById('kpi-fat').innerText = formatBRL(t.fat);
    document.getElementById('kpi-die').innerText = formatBRL(t.die);
    document.getElementById('kpi-luc').innerText = formatBRL(t.luc);
    document.getElementById('kpi-mar').innerText = (t.fat > 0 ? (t.luc / t.fat)*100 : 0).toFixed(1) + '%';
    document.getElementById('status-alerts').innerHTML = criticalCount > 0 ? `<span class="badge bg-danger">${criticalCount} Alertas</span>` : '';

    updateCharts(data, t);
    updateRanking(data);
    updateMaintenance();
}

// 5. Renderizar Aba de Comissões
function renderComissoes(data) {
    const comissoesPorMotorista = {};
    data.forEach(i => {
        const mot = i.motorista || 'Não Identificado';
        if (!comissoesPorMotorista[mot]) {
            comissoesPorMotorista[mot] = { viagens: 0, freteTotal: 0, comissaoTotal: 0 };
        }
        comissoesPorMotorista[mot].viagens += 1;
        comissoesPorMotorista[mot].freteTotal += parseFloat(i.frete || 0);
        comissoesPorMotorista[mot].comissaoTotal += parseFloat(i.comissoes || 0);
    });

    const tbody = document.getElementById('comissaoTableBody');
    if(tbody) {
        tbody.innerHTML = "";
        Object.entries(comissoesPorMotorista).forEach(([nome, info]) => {
            tbody.innerHTML += `
                <tr>
                    <td><b>${nome}</b></td>
                    <td>${info.viagens}</td>
                    <td>${formatBRL(info.freteTotal)}</td>
                    <td class="comissao-total">${formatBRL(info.comissaoTotal)}</td>
                </tr>`;
        });
    }
}

// 6. NOVO: Sistema de Gasto de Diesel por Motorista
function renderGastoDiesel(data) {
    const gastosPorMotorista = {};
    
    data.forEach(i => {
        const mot = i.motorista || 'Não Identificado';
        const valorDiesel = parseFloat(i.diesel || 0);
        
        if (!gastosPorMotorista[mot]) {
            gastosPorMotorista[mot] = 0;
        }
        gastosPorMotorista[mot] += valorDiesel;
    });

    const rankingGasto = Object.entries(gastosPorMotorista).sort((a, b) => b[1] - a[1]);

    const list = document.getElementById('diesel-ranking-list');
    if(list) {
        list.innerHTML = "";
        rankingGasto.forEach(([nome, total]) => {
            list.innerHTML += `
                <div class="ranking-item">
                    <span>${nome}</span>
                    <span class="text-warning" style="font-weight:bold">${formatBRL(total)}</span>
                </div>`;
        });
    }
}

// 7. Atualizar Gráficos
function updateCharts(data, t) {
    if(charts.evol) charts.evol.destroy();
    charts.evol = new Chart(document.getElementById('chartEvol'), {
        type: 'line',
        data: {
            labels: data.map(i => i.data),
            datasets: [
                { label: 'Frete', data: data.map(i => i.frete), borderColor: '#58a6ff', tension: 0.3 },
                { label: 'Custos', data: data.map(i => (parseFloat(i.diesel)+parseFloat(i.manutencao))), borderColor: '#f85149', tension: 0.3 }
            ]
        }
    });

    if(charts.cost) charts.cost.destroy();
    charts.cost = new Chart(document.getElementById('chartCosts'), {
        type: 'doughnut',
        data: {
            labels: ['Diesel', 'Comissão', 'Manut.', 'Líquido'],
            datasets: [{ 
                data: [t.die, t.com, t.man, Math.max(0, t.luc)], 
                backgroundColor: ['#f1c40f', '#a371f7', '#f85149', '#39d353'] 
            }]
        },
        options: { cutout: '70%', plugins: { legend: { position: 'bottom' } } }
    });
}

// 8. Atualizar Ranking Top 3 Lucro
function updateRanking(data) {
    const ranks = {};
    data.forEach(i => {
        if(!ranks[i.motorista]) ranks[i.motorista] = 0;
        ranks[i.motorista] += (parseFloat(i.frete) - parseFloat(i.diesel) - parseFloat(i.comissoes) - parseFloat(i.manutencao));
    });
    const sorted = Object.entries(ranks).sort((a,b) => b[1] - a[1]).slice(0, 3);
    const list = document.getElementById('ranking-list');
    if(list) {
        list.innerHTML = "";
        sorted.forEach(([name, val], idx) => {
            list.innerHTML += `<div class="ranking-item"><span><b>${idx+1}º</b> ${name}</span> <span>${formatBRL(val)}</span></div>`;
        });
    }
}

// 9. Atualizar Dias sem Manutenção
function updateMaintenance() {
    const plates = {};
    const today = new Date();
    db.forEach(i => {
        if(parseFloat(i.manutencao) > 0) {
            const d = new Date(i.data);
            if(!plates[i.placa] || d > plates[i.placa]) plates[i.placa] = d;
        }
    });
    const list = document.getElementById('maint-list');
    if(list) {
        list.innerHTML = "";
        Object.entries(plates).forEach(([placa, data]) => {
            const diffDays = Math.floor((today - data) / (1000 * 60 * 60 * 24));
            const color = diffDays > 30 ? 'bg-danger' : 'bg-success';
            list.innerHTML += `<div class="ranking-item"><span>${placa}</span> <span class="badge ${color}">${diffDays} dias</span></div>`;
        });
    }
}

// 10. Auxiliares e Troca de Tema
function formatBRL(v) { 
    return v.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' }); 
}

const themeToggle = document.getElementById('themeToggle');
if(themeToggle) {
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('light-mode');
        const isLight = document.body.classList.contains('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
}

if (localStorage.getItem('theme') === 'light' && themeToggle) {
    themeToggle.checked = true;
    document.body.classList.add('light-mode');
}



