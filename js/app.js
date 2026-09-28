// =========================================================
// Control de Avance de Obra — lógica principal
// =========================================================

let CURRENT_USER = null;   // { id, email }
let CURRENT_PROFILE = null; // { rol, nombre_completo }
let PROYECTOS = [];
let PARTIDAS = [];          // partidas del proyecto seleccionado
let AVANCES = [];           // avances del proyecto seleccionado (todas las partidas)

// ---------------------------------------------------------
// Autenticación / arranque
// ---------------------------------------------------------
(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "index.html"; return; }
  CURRENT_USER = session.user;

  const { data: perfil } = await supabaseClient
    .from("perfiles")
    .select("*")
    .eq("id", CURRENT_USER.id)
    .single();
  CURRENT_PROFILE = perfil || { rol: "residente", nombre_completo: CURRENT_USER.email };

  document.getElementById("userName").textContent = CURRENT_PROFILE.nombre_completo || CURRENT_USER.email;
  document.getElementById("userRole").textContent = "(" + CURRENT_PROFILE.rol + ")";

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
  });

  setupTabs();
  await loadProyectos();
  setupAvanceForm();
  document.getElementById("buscarPartida").addEventListener("input", renderPartidasTable);

  // fecha por defecto = hoy
  document.getElementById("semanaFin").value = new Date().toISOString().slice(0,10);
})();

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.view).classList.add("active");
    });
  });
}

// ---------------------------------------------------------
// Proyectos
// ---------------------------------------------------------
async function loadProyectos() {
  const { data, error } = await supabaseClient.from("proyectos").select("*").order("created_at");
  if (error) { console.error(error); return; }
  PROYECTOS = data || [];

  const selects = [
    document.getElementById("proyectoSelectDash"),
    document.getElementById("proyectoSelectAvance"),
    document.getElementById("proyectoSelectPartidas"),
  ];
  selects.forEach(sel => {
    sel.innerHTML = PROYECTOS.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join("");
    sel.addEventListener("change", () => onProyectoChange());
  });

  if (PROYECTOS.length > 0) await onProyectoChange();
}

async function onProyectoChange() {
  const proyectoId = document.getElementById("proyectoSelectDash").value ||
                      document.getElementById("proyectoSelectAvance").value ||
                      document.getElementById("proyectoSelectPartidas").value;
  // sincroniza los 3 selects al mismo proyecto
  [document.getElementById("proyectoSelectDash"),
   document.getElementById("proyectoSelectAvance"),
   document.getElementById("proyectoSelectPartidas")].forEach(sel => sel.value = proyectoId);

  await loadPartidasYAvances(proyectoId);
  renderPartidasTable();
  renderPartidaSelectAvance();
  await renderUltimosAvances();
  renderDashboard();
}

async function loadPartidasYAvances(proyectoId) {
  const { data: partidas } = await supabaseClient
    .from("partidas").select("*").eq("proyecto_id", proyectoId).order("orden");
  PARTIDAS = partidas || [];

  const partidaIds = PARTIDAS.map(p => p.id);
  if (partidaIds.length === 0) { AVANCES = []; return; }

  const { data: avances } = await supabaseClient
    .from("avances_semanales").select("*").in("partida_id", partidaIds).order("semana_fin");
  AVANCES = avances || [];
}

// ---------------------------------------------------------
// Vista: PARTIDAS (línea base editable)
// ---------------------------------------------------------
const MAX_FILAS_PARTIDAS = 300;

function renderPartidasTable() {
  const tbody = document.querySelector("#tablaPartidas tbody");
  const filtro = (document.getElementById("buscarPartida").value || "").trim().toLowerCase();
  tbody.innerHTML = "";
  const canEdit = CURRENT_PROFILE.rol === "admin" || CURRENT_PROFILE.rol === "planner";

  let lista = PARTIDAS;
  if (filtro.length >= 2) {
    lista = PARTIDAS.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  } else if (PARTIDAS.length > MAX_FILAS_PARTIDAS) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">Hay ${PARTIDAS.length} partidas — escribe al menos 2 letras en el buscador para verlas (por nombre o por frente).</td></tr>`;
    return;
  }

  if (lista.length > MAX_FILAS_PARTIDAS) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--text-muted); padding:16px;">${lista.length} resultados — afina más la búsqueda (mostrando los primeros ${MAX_FILAS_PARTIDAS}).</td></tr>`;
    lista = lista.slice(0, MAX_FILAS_PARTIDAS);
  }

  let lastFrente = null;
  lista.forEach(p => {
    if (p.frente !== lastFrente) {
      lastFrente = p.frente;
      const trGroup = document.createElement("tr");
      trGroup.className = "frente-group-row";
      trGroup.innerHTML = `<td colspan="7">${escapeHtml(p.frente)}</td>`;
      tbody.appendChild(trGroup);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding-left:20px;">${escapeHtml(p.nombre)}</td>
      <td>${fmtDate(p.fecha_inicio_base)}</td>
      <td>${fmtDate(p.fecha_fin_base)}</td>
      <td><input type="text" data-field="unidad" value="${escapeAttr(p.unidad || '')}" style="width:60px;" ${canEdit ? '' : 'disabled'}></td>
      <td><input type="number" step="0.0001" data-field="metrado_total" value="${p.metrado_total}" ${canEdit ? '' : 'disabled'}></td>
      <td><input type="number" step="0.0001" data-field="precio_unitario" value="${p.precio_unitario}" ${canEdit ? '' : 'disabled'}></td>
      <td class="presupuesto-cell" style="font-weight:600;">S/ ${Number(p.presupuesto_total || 0).toLocaleString('es-PE', {maximumFractionDigits:2})}</td>
    `;
    tbody.appendChild(tr);

    tr.querySelectorAll("input").forEach(input => {
      input.addEventListener("change", async () => {
        const field = input.dataset.field;
        const value = field === "unidad" ? input.value : parseFloat(input.value || "0");
        p[field] = value;

        const updates = { [field]: value };
        // presupuesto_total se recalcula automáticamente si cambia metrado o P.U.
        if (field === "metrado_total" || field === "precio_unitario") {
          p.presupuesto_total = Number(p.metrado_total || 0) * Number(p.precio_unitario || 0);
          updates.presupuesto_total = p.presupuesto_total;
          tr.querySelector(".presupuesto-cell").textContent = "S/ " + p.presupuesto_total.toLocaleString('es-PE', {maximumFractionDigits:2});
        }

        const { error } = await supabaseClient.from("partidas").update(updates).eq("id", p.id);
        if (error) { alert("No se pudo guardar: " + error.message); return; }
        renderDashboard();
      });
    });
  });
}

// ---------------------------------------------------------
// Vista: REGISTRAR AVANCE
// ---------------------------------------------------------
const MAX_OPCIONES_AVANCE = 150;

function renderPartidaSelectAvance() {
  const sel = document.getElementById("partidaSelect");
  const filtro = (document.getElementById("buscarPartidaAvance").value || "").trim().toLowerCase();

  let lista = PARTIDAS;
  if (filtro.length >= 2) {
    lista = PARTIDAS.filter(p => p.nombre.toLowerCase().includes(filtro) || p.frente.toLowerCase().includes(filtro));
  }
  const truncado = lista.length > MAX_OPCIONES_AVANCE;
  if (truncado) lista = lista.slice(0, MAX_OPCIONES_AVANCE);

  let lastFrente = null;
  let html = "";
  if (lista.length === 0) {
    html = `<option disabled>Sin resultados</option>`;
  }
  lista.forEach(p => {
    if (p.frente !== lastFrente) {
      if (lastFrente !== null) html += "</optgroup>";
      html += `<optgroup label="${escapeAttr(p.frente)}">`;
      lastFrente = p.frente;
    }
    html += `<option value="${p.id}" data-unidad="${escapeAttr(p.unidad || '')}">${escapeHtml(p.nombre)}</option>`;
  });
  if (lastFrente !== null) html += "</optgroup>";
  if (truncado) html += `<option disabled>… hay más resultados, afina la búsqueda</option>`;
  sel.innerHTML = html;
  updateUnidadHint();
  sel.onchange = updateUnidadHint;

  document.getElementById("buscarPartidaAvance").oninput = renderPartidaSelectAvance;
}

function updateUnidadHint() {
  const sel = document.getElementById("partidaSelect");
  const opt = sel.options[sel.selectedIndex];
  document.getElementById("unidadHint").textContent = opt ? `(${opt.dataset.unidad || 'unidad'})` : "";
}

function setupAvanceForm() {
  document.getElementById("avanceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const partidaId = document.getElementById("partidaSelect").value;
    const semanaFin = document.getElementById("semanaFin").value;
    const metrado = parseFloat(document.getElementById("metradoEjecutado").value || "0");
    const comentario = document.getElementById("comentarioAvance").value.trim();
    const msgBox = document.getElementById("avanceMsg");
    msgBox.innerHTML = "";

    const { error } = await supabaseClient.from("avances_semanales").upsert({
      partida_id: partidaId,
      semana_fin: semanaFin,
      metrado_ejecutado: metrado,
      comentario,
      registrado_por: CURRENT_USER.id,
    }, { onConflict: "partida_id,semana_fin,registrado_por" });

    if (error) {
      msgBox.innerHTML = `<div class="error-msg">${escapeHtml(error.message)}</div>`;
      return;
    }
    msgBox.innerHTML = `<div class="success-msg">Avance guardado.</div>`;
    document.getElementById("comentarioAvance").value = "";
    document.getElementById("metradoEjecutado").value = "";

    const proyectoId = document.getElementById("proyectoSelectAvance").value;
    await loadPartidasYAvances(proyectoId);
    await renderUltimosAvances();
    renderDashboard();
  });
}

async function renderUltimosAvances() {
  const tbody = document.querySelector("#tablaUltimosAvances tbody");
  tbody.innerHTML = "";
  const recientes = [...AVANCES].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 25);
  if (recientes.length === 0) return;

  const userIds = [...new Set(recientes.map(a => a.registrado_por))];
  const { data: perfiles } = await supabaseClient.from("perfiles").select("id,nombre_completo").in("id", userIds);
  const perfilMap = {};
  (perfiles || []).forEach(p => perfilMap[p.id] = p.nombre_completo);

  recientes.forEach(a => {
    const partida = PARTIDAS.find(p => p.id === a.partida_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(a.created_at.slice(0,10))}</td>
      <td>${escapeHtml(partida ? partida.frente : '')}</td>
      <td>${escapeHtml(partida ? partida.nombre : '(eliminada)')}</td>
      <td>${fmtDate(a.semana_fin)}</td>
      <td>${a.metrado_ejecutado} ${escapeHtml(partida ? partida.unidad : '')}</td>
      <td>${escapeHtml(perfilMap[a.registrado_por] || '')}</td>
      <td></td>
    `;
    if (a.registrado_por === CURRENT_USER.id) {
      const delBtn = document.createElement("button");
      delBtn.className = "small-btn";
      delBtn.textContent = "Eliminar";
      delBtn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar este avance?")) return;
        await supabaseClient.from("avances_semanales").delete().eq("id", a.id);
        const proyectoId = document.getElementById("proyectoSelectAvance").value;
        await loadPartidasYAvances(proyectoId);
        await renderUltimosAvances();
        renderDashboard();
      });
      tr.lastElementChild.appendChild(delBtn);
    }
    tbody.appendChild(tr);
  });
}

// ---------------------------------------------------------
// Vista: DASHBOARD (Curva S física + económica + desface)
// ---------------------------------------------------------
let curvaEconomicaChartInstance = null;
let curvaFisicaChartInstance = null;
const GANTT_EXPANDED = new Set(); // frentes expandidos en el Gantt

// Peso ECONÓMICO: participación de la partida en el presupuesto total (para la curva de valorización S/)
function pesoEconomico(p, totalPresupuesto) {
  if (totalPresupuesto > 0) return (p.presupuesto_total || 0) / totalPresupuesto;
  return 0;
}

function avanceRealAcumuladoEnFecha(partidaId, fecha) {
  const partida = PARTIDAS.find(p => p.id === partidaId);
  if (!partida || !partida.metrado_total) return 0;
  const ejecutado = AVANCES
    .filter(a => a.partida_id === partidaId && a.semana_fin <= fecha)
    .reduce((sum, a) => sum + Number(a.metrado_ejecutado), 0);
  return Math.min(ejecutado / partida.metrado_total, 1);
}

function avancePlanificadoEnFecha(partida, fecha) {
  const d = new Date(fecha);
  const ini = new Date(partida.fecha_inicio_base);
  const fin = new Date(partida.fecha_fin_base);
  if (d <= ini) return 0;
  if (d >= fin) return 1;
  if (fin - ini <= 0) return 1;
  return (d - ini) / (fin - ini);
}

function generarSemanas() {
  if (PARTIDAS.length === 0) return [];
  const inicios = PARTIDAS.map(p => new Date(p.fecha_inicio_base));
  const fines = PARTIDAS.map(p => new Date(p.fecha_fin_base));
  const start = new Date(Math.min(...inicios));
  const today = new Date();
  const end = new Date(Math.max(...fines, today));
  const semanas = [];
  let d = new Date(start);
  while (d <= end) {
    semanas.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate() + 7);
  }
  semanas.push(end.toISOString().slice(0,10));
  return semanas;
}

function calcularCurvas() {
  const totalPresupuesto = PARTIDAS.reduce((s,p) => s + (p.presupuesto_total || 0), 0);
  const partidasConMetrado = PARTIDAS.filter(p => p.metrado_total > 0);
  const semanas = generarSemanas();

  // --- Curva ECONÓMICA (S/): ponderada por presupuesto -> mide valorización real ---
  const economicoPlan = semanas.map(fecha =>
    PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, fecha), 0) * 100
  );
  const economicoReal = semanas.map(fecha =>
    PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, fecha), 0) * 100
  );

  // --- Curva FÍSICA / EJECUCIÓN (%): promedio simple entre partidas, sin ponderar por costo ---
  const n = partidasConMetrado.length;
  const fisicoPlan = semanas.map(fecha =>
    n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avancePlanificadoEnFecha(p, fecha), 0) / n * 100
  );
  const fisicoReal = semanas.map(fecha =>
    n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avanceRealAcumuladoEnFecha(p.id, fecha), 0) / n * 100
  );

  return { semanas, economicoPlan, economicoReal, fisicoPlan, fisicoReal, totalPresupuesto, nPartidasConMetrado: n };
}

function renderDashboard() {
  const { semanas, economicoPlan, economicoReal, fisicoPlan, fisicoReal, totalPresupuesto } = calcularCurvas();
  const hoy = new Date().toISOString().slice(0,10);

  // Importante: los stats de "hoy" se calculan EN LA FECHA DE HOY, no tomando el último
  // punto del gráfico (que llega hasta el fin de obra, no hasta la fecha actual).
  const partidasConMetrado = PARTIDAS.filter(p => p.metrado_total > 0);
  const n = partidasConMetrado.length;

  const econRealHoy = PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) * 100;
  const econPlanHoy = PARTIDAS.reduce((sum, p) => sum + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, hoy), 0) * 100;
  const econDesface = econRealHoy - econPlanHoy;
  const montoValorizado = totalPresupuesto * econRealHoy / 100;

  const fisRealHoy = n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avanceRealAcumuladoEnFecha(p.id, hoy), 0) / n * 100;
  const fisPlanHoy = n === 0 ? 0 : partidasConMetrado.reduce((sum, p) => sum + avancePlanificadoEnFecha(p, hoy), 0) / n * 100;
  const fisDesface = fisRealHoy - fisPlanHoy;

  const statRow = document.getElementById("statRow");
  statRow.innerHTML = `
    <div class="stat-tile">
      <div class="label">Avance económico (valorizado)</div>
      <div class="value">${econRealHoy.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Monto valorizado a hoy</div>
      <div class="value">${totalPresupuesto > 0 ? 'S/ ' + montoValorizado.toLocaleString('es-PE', {maximumFractionDigits:0}) : 'Sin datos'}</div>
    </div>
    <div class="stat-tile">
      <div class="label">Desface económico</div>
      <div class="value ${econDesface >= 0 ? 'good' : 'bad'}">${econDesface >= 0 ? '+' : ''}${econDesface.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Avance físico (ejecución)</div>
      <div class="value">${fisRealHoy.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Desface físico</div>
      <div class="value ${fisDesface >= 0 ? 'good' : 'bad'}">${fisDesface >= 0 ? '+' : ''}${fisDesface.toFixed(1)}%</div>
    </div>
    <div class="stat-tile">
      <div class="label">Presupuesto total (línea base)</div>
      <div class="value">${totalPresupuesto > 0 ? 'S/ ' + totalPresupuesto.toLocaleString('es-PE', {maximumFractionDigits:0}) : 'Sin datos'}</div>
    </div>
  `;

  if (totalPresupuesto === 0) {
    statRow.insertAdjacentHTML("beforeend", `
      <div class="stat-tile" style="grid-column:1/-1;">
        <div class="label" style="color:var(--red);">⚠ Aún no hay presupuesto cargado en "Partidas" — la curva económica no puede ponderar hasta completar esos datos.</div>
      </div>
    `);
  }

  const labels = semanas.map(fmtDate);

  const econCtx = document.getElementById("curvaEconomicaChart").getContext("2d");
  if (curvaEconomicaChartInstance) curvaEconomicaChartInstance.destroy();
  curvaEconomicaChartInstance = new Chart(econCtx, lineChartConfig(labels, economicoPlan, economicoReal, "#898781", "#2a78d6", "rgba(42,120,214,0.08)"));

  const fisCtx = document.getElementById("curvaFisicaChart").getContext("2d");
  if (curvaFisicaChartInstance) curvaFisicaChartInstance.destroy();
  curvaFisicaChartInstance = new Chart(fisCtx, lineChartConfig(labels, fisicoPlan, fisicoReal, "#898781", "#1baf7a", "rgba(27,175,122,0.08)"));

  renderTablaDesfacePorFrente(totalPresupuesto, hoy);
  renderGantt();
}

function lineChartConfig(labels, planData, realData, colorPlan, colorReal, fillReal) {
  return {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Línea base (planificado)", data: planData, borderColor: colorPlan, backgroundColor: "transparent", borderDash: [5,3], tension: 0.15, pointRadius: 0 },
        { label: "Avance real", data: realData, borderColor: colorReal, backgroundColor: fillReal, fill: true, tension: 0.15, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + "%" } },
        x: { ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 16 } },
      },
    },
  };
}

function renderTablaDesfacePorFrente(totalPresupuesto, hoy) {
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))];
  const tbody = document.querySelector("#tablaDesfaceFrente tbody");
  tbody.innerHTML = "";

  frentes.forEach(frente => {
    const partidasFrente = PARTIDAS.filter(p => p.frente === frente);
    const pesoTotalFrente = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto), 0);
    if (pesoTotalFrente === 0) {
      tbody.insertAdjacentHTML("beforeend", `<tr><td>${escapeHtml(frente)}</td><td colspan="4" style="color:var(--text-muted);">Sin presupuesto cargado</td></tr>`);
      return;
    }
    const real = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) / pesoTotalFrente * 100;
    const plan = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avancePlanificadoEnFecha(p, hoy), 0) / pesoTotalFrente * 100;
    const desface = real - plan;
    let badge = 'ok', texto = 'En línea';
    if (desface < -10) { badge = 'late'; texto = 'Atrasado'; }
    else if (desface < -2) { badge = 'warn'; texto = 'Leve atraso'; }

    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(frente)}</td>
        <td>${real.toFixed(1)}%</td>
        <td>${plan.toFixed(1)}%</td>
        <td style="color:${desface >= 0 ? 'var(--green)' : 'var(--red)'}">${desface >= 0 ? '+' : ''}${desface.toFixed(1)}%</td>
        <td><span class="badge ${badge}">${texto}</span></td>
      </tr>
    `);
  });
}

// ---------------------------------------------------------
// Vista: GANTT DE AVANCE (por frente, expandible a partidas)
// ---------------------------------------------------------
function renderGantt() {
  const wrap = document.getElementById("ganttWrap");
  if (!wrap) return;

  if (PARTIDAS.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Sin partidas cargadas para este proyecto.</p>`;
    return;
  }

  const totalPresupuesto = PARTIDAS.reduce((s,p) => s + (p.presupuesto_total || 0), 0);
  const hoy = new Date().toISOString().slice(0,10);

  const conFechas = PARTIDAS.filter(p => p.fecha_inicio_base && p.fecha_fin_base);
  if (conFechas.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Ninguna partida tiene fechas base cargadas todavía.</p>`;
    return;
  }

  const start = new Date(Math.min(...conFechas.map(p => new Date(p.fecha_inicio_base))));
  const end = new Date(Math.max(...conFechas.map(p => new Date(p.fecha_fin_base))));
  const totalMs = end - start;
  if (!(totalMs > 0)) {
    wrap.innerHTML = `<p style="color:var(--text-muted);">Fechas base insuficientes para dibujar el Gantt.</p>`;
    return;
  }

  const pct = (date) => Math.max(0, Math.min(100, (date - start) / totalMs * 100));
  const todayPct = pct(new Date());

  // Agrupa por frente y calcula rango de fechas + % avance económico a hoy
  const frentes = [...new Set(PARTIDAS.map(p => p.frente))];
  const frenteData = frentes.map(frente => {
    const partidasFrente = PARTIDAS.filter(p => p.frente === frente && p.fecha_inicio_base && p.fecha_fin_base);
    if (partidasFrente.length === 0) return null;
    const fIni = new Date(Math.min(...partidasFrente.map(p => new Date(p.fecha_inicio_base))));
    const fFin = new Date(Math.max(...partidasFrente.map(p => new Date(p.fecha_fin_base))));
    const pesoTotalFrente = partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto), 0);
    const real = pesoTotalFrente > 0
      ? partidasFrente.reduce((s,p) => s + pesoEconomico(p, totalPresupuesto) * avanceRealAcumuladoEnFecha(p.id, hoy), 0) / pesoTotalFrente * 100
      : 0;
    return { frente, partidas: partidasFrente, fIni, fFin, real };
  }).filter(Boolean);

  // Meses para la cabecera de la grilla
  const meses = [];
  let dm = new Date(start.getFullYear(), start.getMonth(), 1);
  while (dm <= end) {
    meses.push(new Date(dm));
    dm.setMonth(dm.getMonth() + 1);
  }
  const mesesNombres = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  const gridlinesHtml = meses.map(m =>
    `<div class="gantt-gridline" style="left:${pct(m)}%"></div><div class="gantt-month-label" style="left:${pct(m)}%">${mesesNombres[m.getMonth()]} ${m.getFullYear()}</div>`
  ).join("");

  let labelsHtml = `<div class="gantt-row gantt-header-row"><div class="gantt-label"></div></div>`;
  let tracksHtml = `<div class="gantt-track-row header-row"><div class="gantt-gridlines">${gridlinesHtml}</div></div>`;

  function barRow(left, width, avancePct, colorFill) {
    const w = Math.max(width, 0.4);
    const fillW = w * Math.max(0, Math.min(avancePct, 100)) / 100;
    const completo = avancePct >= 100;
    return `
      <div class="gantt-bar-bg" style="left:${left}%; width:${w}%;"></div>
      <div class="gantt-bar-fill ${completo ? 'completo' : ''}" style="left:${left}%; width:${fillW}%; background:${colorFill};"></div>
      <div class="gantt-pct-label" style="left:${Math.min(left + w + 1, 95)}%;">${avancePct.toFixed(0)}%</div>
      <div class="gantt-today-line" style="left:${todayPct}%;"></div>
    `;
  }

  frenteData.forEach(fd => {
    const expanded = GANTT_EXPANDED.has(fd.frente);
    const left = pct(fd.fIni);
    const width = pct(fd.fFin) - left;

    labelsHtml += `<div class="gantt-row frente-row" data-frente="${escapeAttr(fd.frente)}"><div class="gantt-label">${expanded ? '▾' : '▸'} ${escapeHtml(fd.frente)}</div></div>`;
    tracksHtml += `<div class="gantt-track-row frente-row" data-frente="${escapeAttr(fd.frente)}">${barRow(left, width, fd.real, '#2a78d6')}</div>`;

    if (expanded) {
      fd.partidas.forEach(p => {
        const pReal = avanceRealAcumuladoEnFecha(p.id, hoy) * 100;
        const pLeft = pct(new Date(p.fecha_inicio_base));
        const pWidth = pct(new Date(p.fecha_fin_base)) - pLeft;

        labelsHtml += `<div class="gantt-row partida-row"><div class="gantt-label" title="${escapeAttr(p.nombre)}">${escapeHtml(p.nombre)}</div></div>`;
        tracksHtml += `<div class="gantt-track-row">${barRow(pLeft, pWidth, pReal, '#1baf7a')}</div>`;
      });
    }
  });

  wrap.innerHTML = `
    <div class="gantt-chart">
      <div class="gantt-labels-col">${labelsHtml}</div>
      <div class="gantt-chart-col">${tracksHtml}</div>
    </div>
    <div class="legend-row">
      <span><span class="legend-dot" style="background:#2a78d6"></span>Avance económico por frente</span>
      <span><span class="legend-dot" style="background:#1baf7a"></span>Avance económico por partida (al expandir)</span>
      <span><span class="legend-dot" style="background:var(--red)"></span>Hoy</span>
    </div>
  `;

  wrap.querySelectorAll(".frente-row[data-frente]").forEach(row => {
    row.addEventListener("click", () => {
      const frente = row.dataset.frente;
      if (GANTT_EXPANDED.has(frente)) GANTT_EXPANDED.delete(frente);
      else GANTT_EXPANDED.add(frente);
      renderGantt();
    });
  });
}

// ---------------------------------------------------------
// Utilidades
// ---------------------------------------------------------
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${String(d.getDate()).padStart(2,'0')}-${meses[d.getMonth()]}-${d.getFullYear()}`;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
