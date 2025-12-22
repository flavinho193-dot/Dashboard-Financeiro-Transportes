/* ==========================================================================
   BELISIO EXPRESS - COMMAND CENTER v3.0 (GESTÃO VIA PLANILHA)
   ========================================================================== */

let db = [];
let charts = {};

// 1. Tabela de Referência ANTT (Custo por KM/Eixo)
const tabelaANTT = {
    2: 4.85, 3: 5.92, 5: 7.40, 6: 8.65, 7: 9.20, 9: 11.50
};

// 2. Carregamento de Dados (Google Sheets via CSV)
async function loadAutoData() {
    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSjNb11bcijL_wpJ8JM6KB8tDih5-34uXxJFyFVC7_pF8PxtoB-_ekFPVpPP44BoodHfavnPIuHi6Mt/pub?output=csv'; 
    
    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error("Não foi possível ler a planilha.");
        
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
        console.log("Dashboard Belisio Express v3.0 Conectado!");
    } catch (error) {
        console.error("Erro na conexão:", error);
    }
}

window.onload = loadAutoData;

// 3. Sistema de Filtros
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
    renderLogistica(filtered);
    updateKmChart(filtered);
}

// 4. Dashboard Geral
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

        tbody.innerHTML += `
            <tr>
                <td>${i.data || '-'}</td>
                <td>${i.motorista || '-'}</td>
                <td>${i.placa || '-'}</td>
                <td>${formatBRL(f)}</td>
                <td>${formatBRL(d)}</td>
                <td>${formatBRL(m)}</td>
                <td>${formatBRL(c)}</td>
                <td style="color:var(--success); font-weight:bold">${formatBRL(lucro)}</td>
                <td class="${margem >= 15 ? 'pos-margem' : 'neg-margem'}">
                    ${margem.toFixed(1)}%
                </td>
            </tr>`;
    });

    document.getElementById('kpi-fat').innerText = formatBRL(t.fat);
    document.getElementById('kpi-die').innerText = formatBRL(t.die);
    document.getElementById('kpi-luc').innerText = formatBRL(t.luc);
    document.getElementById('kpi-mar').innerText = (t.fat > 0 ? (t.luc / t.fat)*100 : 0).toFixed(1) + '%';
    
    updateCharts(data, t);
    updateMaintenance();
}

// 5. Logística e Auditoria ANTT
function renderLogistica(data) {
    const tbody = document.getElementById('logisticaTableBody');
    if(!tbody) return;
    tbody.innerHTML = "";

    data.forEach(i => {
        const km = parseFloat(i.km || 0);
        const freteReal = parseFloat(i.frete || 0);
        const placa = (i.placa || "").trim().toUpperCase();
        const numEixos = parseInt(i.eixos) || 3; 
        
        const valorMinimoANTT = km * (tabelaANTT[numEixos] || 6.00);
        const corStatus = freteReal >= valorMinimoANTT ? "#39d353" : "#f85149";

        tbody.innerHTML += `
            <tr>
                <td><span class="badge bg-secondary">${placa}</span></td>
                <td>${i.motorista || '-'}</td>
                <td>${i.origem || '?'} → ${i.destino || '?'}</td>
                <td><b>${km} KM</b></td>
                <td><div style="font-weight:bold; color: ${corStatus}">${formatBRL(freteReal)}</div></td>
                <td><span class="badge" style="background-color: ${corStatus}">${freteReal >= valorMinimoANTT ? '✅ OK' : '⚠️ BAIXO'}</span></td>
            </tr>`;
    });
}

// 6. Comissões e Ranking de Lucratividade (Nova localização com Diesel)
function renderComissoes(data) {
    const coms = {};
    const ranks = {};

    data.forEach(i => {
        const mot = i.motorista || 'Não Identificado';
        const f = parseFloat(i.frete || 0);
        const d = parseFloat(i.diesel || 0);
        const c = parseFloat(i.comissoes || 0);
        const m = parseFloat(i.manutencao || 0);
        const lucroLiquido = f - d - c - m;

        // Agrupamento para a Tabela de Comissões + Diesel
        if (!coms[mot]) coms[mot] = { viagens: 0, frete: 0, valor: 0, diesel: 0 };
        coms[mot].viagens++;
        coms[mot].frete += f;
        coms[mot].valor += c;
        coms[mot].diesel += d; // Soma o gasto de diesel

        // Agrupamento para o Ranking
        ranks[mot] = (ranks[mot] || 0) + lucroLiquido;
    });

    // Renderiza Tabela de Comissões
    const tbody = document.getElementById('comissaoTableBody');
    if(tbody) {
        tbody.innerHTML = "";
        Object.entries(coms).forEach(([nome, info]) => {
            tbody.innerHTML += `
                <tr>
                    <td><b>${nome}</b></td>
                    <td>${info.viagens}</td>
                    <td>${formatBRL(info.frete)}</td>
                    <td style="color:var(--warning)">${formatBRL(info.diesel)}</td>
                    <td style="color:var(--accent); font-weight:bold">${formatBRL(info.valor)}</td>
                </tr>`;
        });
    }

    // Renderiza o Top 3 Lucratividade na mesma aba
    const rankContainer = document.getElementById('ranking-lucratividade-comissao');
    if(rankContainer) {
        rankContainer.innerHTML = "<h6 class='text-muted mb-3'>🏆 TOP 3 LUCRATIVIDADE NO PERÍODO</h6>";
        Object.entries(ranks)
            .sort((a,b) => b[1]-a[1])
            .slice(0,3)
            .forEach(([name, val], idx) => {
                const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
                rankContainer.innerHTML += `
                    <div class="ranking-item" style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1)">
                        <span>${medal} <b>${name}</b></span> 
                        <span style="color:#39d353; font-weight:bold">${formatBRL(val)}</span>
                    </div>`;
            });
    }
}

// 7. Gráficos e Manutenção
function updateCharts(data, t) {
    if(charts.evol) charts.evol.destroy();
    const ctxEvol = document.getElementById('chartEvol');
    if(ctxEvol) {
        charts.evol = new Chart(ctxEvol, {
            type: 'line',
            data: {
                labels: data.map(i => i.data),
                datasets: [
                    { label: 'Frete', data: data.map(i => i.frete), borderColor: '#58a6ff', tension: 0.3 },
                    { label: 'Custos', data: data.map(i => (parseFloat(i.diesel)+parseFloat(i.manutencao))), borderColor: '#f85149', tension: 0.3 }
                ]
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
                datasets: [{ data: [t.die, t.com, t.man, Math.max(0, t.luc)], backgroundColor: ['#f1c40f', '#a371f7', '#f85149', '#39d353'] }]
            },
            options: { cutout: '70%', plugins: { legend: { position: 'bottom' } } }
        });
    }
}

function updateKmChart(data) {
    const kmPorPlaca = {};
    data.forEach(i => {
        const placa = i.placa || 'Sem Placa';
        kmPorPlaca[placa] = (kmPorPlaca[placa] || 0) + parseFloat(i.km || 0);
    });
    if(charts.kmPlaca) charts.kmPlaca.destroy();
    const ctx = document.getElementById('chartKmPlaca');
    if(ctx) {
        charts.kmPlaca = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(kmPorPlaca),
                datasets: [{ label: 'KM Total', data: Object.values(kmPorPlaca), backgroundColor: '#58a6ff' }]
            }
        });
    }
}

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
            list.innerHTML += `<div class="ranking-item"><span>${placa}</span> <span class="badge ${diffDays > 30 ? 'bg-danger' : 'bg-success'}">${diffDays} dias</span></div>`;
        });
    }
}

function formatBRL(v) { return v.toLocaleString('pt-br', { style: 'currency', currency: 'BRL' }); }

// Gerenciamento de Tema
const themeToggle = document.getElementById('themeToggle');
if(themeToggle) {
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
    });
    if (localStorage.getItem('theme') === 'light') {
        themeToggle.checked = true;
        document.body.classList.add('light-mode');
    }
}



