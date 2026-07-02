import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const loginError = document.getElementById('loginError');
const content = document.getElementById('content');
const viewTitle = document.getElementById('viewTitle');
const userChip = document.getElementById('userChip');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');

let currentUser = null;
let currentView = 'resumen';
let solicitudesCache = [];
let modalResolver = null;

const actionModal = document.getElementById('actionModal');
const modalTitle = document.getElementById('modalTitle');
const modalSubtitle = document.getElementById('modalSubtitle');
const modalFields = document.getElementById('modalFields');
const modalError = document.getElementById('modalError');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');

document.querySelectorAll('[data-close-modal]').forEach((el) => {
  el.addEventListener('click', closeModal);
});

modalConfirmBtn.addEventListener('click', async () => {
  if (!modalResolver) return;
  modalError.classList.add('hidden');
  modalConfirmBtn.disabled = true;
  try {
    await modalResolver();
    closeModal();
    if (currentView === 'solicitudes') await renderSolicitudes();
  } catch (e) {
    modalError.textContent = firestoreErrorMessage(e);
    modalError.classList.remove('hidden');
  } finally {
    modalConfirmBtn.disabled = false;
  }
});

content.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-solicitud-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.solicitudAction;
  const row = solicitudesCache.find((r) => r.id === id);
  if (!row) return;
  if (action === 'aprobar') await handleAprobar(row);
  if (action === 'condicionar') await handleCondicionar(row);
  if (action === 'rechazar') await handleRechazar(row);
  if (action === 'desembolsar') await handleDesembolsar(row);
});

const titles = {
  resumen: 'Resumen',
  clientes: 'Clientes',
  solicitudes: 'Solicitudes de crédito',
  creditos: 'Créditos',
  portal: 'Portal Cliente',
  usuarios: 'Usuarios — Fuerza de Ventas',
  cartera: 'Cartera diaria',
};

async function doLogin() {
  loginError.classList.add('hidden');
  const email = toInstitutionalEmail(emailInput.value);
  const password = passwordInput.value;
  if (!email || !password) {
    loginError.textContent = 'Ingrese código/correo y contraseña.';
    loginError.classList.remove('hidden');
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    loginError.textContent = authErrorMessage(e);
    loginError.classList.remove('hidden');
  }
}

function toInstitutionalEmail(value) {
  const v = value.trim();
  if (!v) return '';
  if (v.includes('@')) return v.toLowerCase();
  return `${v.toLowerCase()}@cajacusco.com`;
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});
emailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});

document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentView = btn.dataset.view;
    document.querySelectorAll('.nav-btn[data-view]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderView();
  });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    return;
  }

  try {
    const profile = await loadStaffProfile(user.uid);
    if (!profile) {
      await signOut(auth);
      loginError.textContent =
        'Autenticación correcta, pero falta el documento usuarios/{uid} en Firestore.';
      loginError.classList.remove('hidden');
      loginView.classList.remove('hidden');
      appView.classList.add('hidden');
      return;
    }

    if (!isProfileActive(profile)) {
      await signOut(auth);
      loginError.textContent = 'Su cuenta no está activa. Contacte al administrador.';
      loginError.classList.remove('hidden');
      loginView.classList.remove('hidden');
      appView.classList.add('hidden');
      return;
    }

    if (!isAdminOrSupervisor(profile)) {
      await signOut(auth);
      const rol = normalizeRol(profile);
      loginError.textContent =
        `Acceso denegado. En usuarios/${user.uid.slice(0, 8)}… su rol es "${rol}". Solo administrador o supervisor.`;
      loginError.classList.remove('hidden');
      loginView.classList.remove('hidden');
      appView.classList.add('hidden');
      return;
    }

    currentUser = { ...user, profile };
    const rol = profile.perfil || profile.rol || 'staff';
    userChip.textContent = `${profile.nombre || user.email} · ${rol}`;
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    renderView();
  } catch (e) {
    await signOut(auth);
    loginError.textContent = firestoreErrorMessage(e);
    loginError.classList.remove('hidden');
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
  }
});

function authErrorMessage(err) {
  const code = err?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return 'Correo o contraseña incorrectos.';
  }
  if (code === 'auth/user-not-found') {
    return 'Usuario no registrado en Firebase Auth.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Espere un momento e intente de nuevo.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Sin conexión. Verifique su red e intente de nuevo.';
  }
  return 'No se pudo iniciar sesión. Verifique correo y contraseña.';
}

function firestoreErrorMessage(err) {
  const code = err?.code || '';
  if (code === 'permission-denied') {
    return 'Sin permiso para leer el perfil. Despliegue firestore.rules o use cuenta admin/supervisor.';
  }
  return `Error al validar acceso: ${err.message || 'desconocido'}`;
}

async function loadStaffProfile(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  if (!snap.exists()) return null;
  return snap.data();
}

function normalizeRol(profile) {
  const raw = (profile.perfil || profile.rol || 'operador')
    .toString()
    .toLowerCase()
    .replace(/\s/g, '');
  if (raw === 'admin') return 'administrador';
  if (raw === 'superoperador') return 'super_operador';
  return raw;
}

function isProfileActive(profile) {
  if (profile.activo === false) return false;
  const estado = (profile.estado || 'activo').toString().toLowerCase();
  return estado === 'activo';
}

function isAdminOrSupervisor(profile) {
  const rol = normalizeRol(profile);
  return rol === 'administrador' || rol === 'supervisor';
}

function normalizeEstado(estado) {
  return (estado || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s/g, '_');
}

function isSolicitudPendiente(estado) {
  const e = normalizeEstado(estado);
  return ['enviado', 'en_evaluacion', 'recibido_comite', 'borrador', 'pendiente'].includes(e);
}

function isSolicitudAprobada(estado) {
  const e = normalizeEstado(estado);
  return e === 'aprobado';
}

function isSolicitudFinal(estado) {
  const e = normalizeEstado(estado);
  return ['desembolsado', 'rechazado', 'condicionado'].includes(e);
}

function renderSolicitudAcciones(row) {
  if (isSolicitudFinal(row.estado)) {
    return '<span class="muted-text">—</span>';
  }
  const parts = [];
  if (isSolicitudPendiente(row.estado)) {
    parts.push(
      `<button type="button" class="btn-sm ok" data-solicitud-action="aprobar" data-id="${esc(row.id)}">Aprobar</button>`,
      `<button type="button" class="btn-sm warn" data-solicitud-action="condicionar" data-id="${esc(row.id)}">Condicionar</button>`,
      `<button type="button" class="btn-sm bad" data-solicitud-action="rechazar" data-id="${esc(row.id)}">Rechazar</button>`,
    );
  }
  if (isSolicitudAprobada(row.estado)) {
    parts.push(
      `<button type="button" class="btn-sm ok" data-solicitud-action="desembolsar" data-id="${esc(row.id)}">Desembolsar</button>`,
    );
  }
  if (parts.length === 0) {
    return '<span class="muted-text">Sin acciones</span>';
  }
  return `<div class="action-group">${parts.join('')}</div>`;
}

function closeModal() {
  actionModal.classList.add('hidden');
  actionModal.setAttribute('aria-hidden', 'true');
  modalResolver = null;
  modalFields.innerHTML = '';
  modalError.classList.add('hidden');
}

function openModal({ title, subtitle, fieldsHtml, onConfirm }) {
  modalTitle.textContent = title;
  modalSubtitle.textContent = subtitle || '';
  modalFields.innerHTML = fieldsHtml || '';
  modalError.classList.add('hidden');
  modalResolver = onConfirm;
  actionModal.classList.remove('hidden');
  actionModal.setAttribute('aria-hidden', 'false');
  const firstInput = modalFields.querySelector('input, textarea, select');
  if (firstInput) firstInput.focus();
}

function readModalField(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

async function handleAprobar(row) {
  const montoDefault = row.montoSolicitado ?? row.monto ?? '';
  openModal({
    title: 'Aprobar solicitud',
    subtitle: `${row.numeroExpediente || row.id} — ${row.nombres || ''} ${row.apellidos || ''}`.trim(),
    fieldsHtml: `
      <label for="montoAprobado">Monto aprobado (PEN)</label>
      <input id="montoAprobado" type="number" min="1" step="0.01" value="${esc(String(montoDefault))}" />
    `,
    onConfirm: async () => {
      const monto = Number(readModalField('montoAprobado'));
      if (!monto || monto <= 0) throw new Error('Ingrese un monto aprobado válido.');
      await updateDoc(doc(db, 'solicitudes_credito', row.id), {
        estado: 'aprobado',
        montoAprobado: monto,
        evaluadoPor: currentUser.uid,
        evaluadoPorNombre: currentUser.profile?.nombre || currentUser.email,
        evaluadoAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  });
}

async function handleCondicionar(row) {
  const montoDefault = Math.round(Number(row.montoSolicitado || row.monto || 0) * 0.8) || '';
  openModal({
    title: 'Condicionar solicitud',
    subtitle: row.numeroExpediente || row.id,
    fieldsHtml: `
      <label for="montoCond">Monto aprobado condicionado (PEN)</label>
      <input id="montoCond" type="number" min="1" step="0.01" value="${esc(String(montoDefault))}" />
      <label for="condicionTxt">Condición / observación</label>
      <textarea id="condicionTxt" rows="3" placeholder="Ej.: Presentar garantía adicional"></textarea>
    `,
    onConfirm: async () => {
      const monto = Number(readModalField('montoCond'));
      const condicion = readModalField('condicionTxt');
      if (!monto || monto <= 0) throw new Error('Ingrese un monto válido.');
      if (!condicion) throw new Error('Indique la condición.');
      await updateDoc(doc(db, 'solicitudes_credito', row.id), {
        estado: 'condicionado',
        montoAprobado: monto,
        condicionAdicional: condicion,
        evaluadoPor: currentUser.uid,
        evaluadoPorNombre: currentUser.profile?.nombre || currentUser.email,
        evaluadoAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  });
}

async function handleRechazar(row) {
  openModal({
    title: 'Rechazar solicitud',
    subtitle: row.numeroExpediente || row.id,
    fieldsHtml: `
      <label for="motivoRechazo">Motivo de rechazo</label>
      <textarea id="motivoRechazo" rows="3" placeholder="Ej.: Capacidad de pago insuficiente"></textarea>
    `,
    onConfirm: async () => {
      const motivo = readModalField('motivoRechazo');
      if (!motivo) throw new Error('Indique el motivo de rechazo.');
      await updateDoc(doc(db, 'solicitudes_credito', row.id), {
        estado: 'rechazado',
        montoAprobado: null,
        motivoRechazo: motivo,
        evaluadoPor: currentUser.uid,
        evaluadoPorNombre: currentUser.profile?.nombre || currentUser.email,
        evaluadoAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  });
}

function calcCuotaMensual(monto, plazo, teaPct) {
  const tea = Number(teaPct || 36) / 100;
  const r = (1 + tea) ** (1 / 12) - 1;
  if (!plazo || plazo <= 0) return monto;
  if (r === 0) return monto / plazo;
  return (monto * r * (1 + r) ** plazo) / ((1 + r) ** plazo - 1);
}

async function handleDesembolsar(row) {
  const monto = row.montoAprobado ?? row.montoSolicitado ?? row.monto;
  openModal({
    title: 'Desembolsar crédito',
    subtitle: `${row.numeroExpediente || row.id} — ${money(monto)}`,
    fieldsHtml: `
      <p class="section-note" style="margin-bottom:12px">
        Se registrará el crédito en Firestore y la solicitud pasará a <strong>desembolsado</strong>.
      </p>
      <label for="fechaDesembolso">Fecha de desembolso</label>
      <input id="fechaDesembolso" type="date" value="${hoyIso()}" />
    `,
    onConfirm: async () => {
      const fecha = readModalField('fechaDesembolso') || hoyIso();
      const montoNum = Number(monto);
      const plazo = Number(row.plazoMeses || row.plazo || 12);
      const tea = Number(row.teaReferencial || row.tea || 36);
      const cuota = Math.round(calcCuotaMensual(montoNum, plazo, tea) * 100) / 100;
      const creditoId = row.creditoId || `credito_${row.id}`;

      await setDoc(
        doc(db, 'creditos', creditoId),
        {
          clienteId: row.clienteId,
          solicitudId: row.id,
          asesorId: row.asesorId,
          agenciaId: row.agenciaId || 'AG001',
          producto: row.producto || 'Crédito Empresarial',
          montoDesembolsado: montoNum,
          plazoMeses: plazo,
          tea,
          estado: 'vigente',
          fechaDesembolso: fecha,
          saldoActual: montoNum,
          cuotasTotal: plazo,
          cuotasPagadas: 0,
          diasMora: 0,
          cuotaMensual: cuota,
          diaPago: row.diaPago || 5,
          origen: 'core_admin',
          desembolsadoPor: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      await updateDoc(doc(db, 'solicitudes_credito', row.id), {
        estado: 'desembolsado',
        montoAprobado: montoNum,
        fechaDesembolso: fecha,
        creditoId,
        desembolsadoPor: currentUser.uid,
        desembolsadoAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
  });
}

function badgeForEstado(estado) {
  const e = (estado || '').toLowerCase();
  if (e.includes('rechaz')) return 'bad';
  if (e.includes('desembols') || e.includes('aprob')) return 'ok';
  if (e.includes('condicion')) return 'warn';
  return 'neutral';
}

function money(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(n));
}

function formatDate(value) {
  if (!value) return '—';
  if (typeof value === 'string') return value;
  if (value.toDate) {
    return value.toDate().toISOString().slice(0, 10);
  }
  return String(value);
}

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text ?? '';
  return d.innerHTML;
}

function emptyPanel(message) {
  return `<div class="panel"><p class="empty-state">${esc(message)}</p></div>`;
}

async function renderView() {
  viewTitle.textContent = titles[currentView] || 'Core';
  content.innerHTML = '<p class="section-note">Cargando…</p>';

  try {
    switch (currentView) {
      case 'resumen':
        await renderResumen();
        break;
      case 'clientes':
        await renderTable('clientes', ['numeroDocumento', 'nombres', 'apellidos', 'nombreNegocio', 'telefono']);
        break;
      case 'solicitudes':
        await renderSolicitudes();
        break;
      case 'creditos':
        await renderCreditos();
        break;
      case 'portal':
        await renderPortal();
        break;
      case 'usuarios':
        await renderUsuarios();
        break;
      case 'cartera':
        await renderCartera();
        break;
      default:
        content.innerHTML = emptyPanel('Vista no disponible.');
    }
  } catch (e) {
    content.innerHTML = `<p class="error">${esc(firestoreErrorMessage(e))}</p>`;
  }
}

async function countCollection(name) {
  const snap = await getCountFromServer(collection(db, name));
  return snap.data().count;
}

async function renderResumen() {
  const [clientes, solicitudes, creditos, portal, usuarios, cartera] = await Promise.all([
    countCollection('clientes'),
    countCollection('solicitudes_credito'),
    countCollection('creditos'),
    countCollection('cuentas_clientes'),
    countCollection('usuarios'),
    countCollection('cartera_diaria'),
  ]);

  content.innerHTML = `
    <p class="section-note">
      Vista unificada del Firestore <strong>caja-cusco-ventas</strong> usado por
      <em>Fuerza de Ventas</em> y <em>Portal Cliente</em>.
    </p>
    <div class="stats">
      <div class="stat-card"><div class="label">Clientes</div><div class="value">${clientes}</div></div>
      <div class="stat-card"><div class="label">Solicitudes</div><div class="value">${solicitudes}</div></div>
      <div class="stat-card"><div class="label">Créditos</div><div class="value">${creditos}</div></div>
      <div class="stat-card"><div class="label">Cuentas portal</div><div class="value">${portal}</div></div>
      <div class="stat-card"><div class="label">Usuarios ventas</div><div class="value">${usuarios}</div></div>
      <div class="stat-card"><div class="label">Cartera diaria</div><div class="value">${cartera}</div></div>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Flujo académico (30 casos)</h3></div>
      <table>
        <thead><tr><th>Resultado</th><th>Cantidad</th><th>Colección</th></tr></thead>
        <tbody>
          <tr><td>Desembolsados</td><td>24</td><td>creditos + solicitudes (desembolsado)</td></tr>
          <tr><td>Condicionados</td><td>3</td><td>solicitudes (condicionado)</td></tr>
          <tr><td>Rechazados</td><td>3</td><td>solicitudes (rechazado)</td></tr>
        </tbody>
      </table>
    </div>`;
}

async function renderTable(colName, fields) {
  const snap = await getDocs(query(collection(db, colName), limit(100)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (rows.length === 0) {
    content.innerHTML = emptyPanel(`No hay registros en ${colName}.`);
    return;
  }

  content.innerHTML = `
    <p class="section-note">Mostrando hasta 100 registros de <code>${colName}</code>.</p>
    <div class="panel">
      <div class="panel-header"><h3>${titles[currentView]}</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead><tr><th>ID</th>${fields.map((f) => `<th>${f}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><code>${esc(r.id.slice(0, 12))}…</code></td>
                ${fields.map((f) => `<td>${esc(String(r[f] ?? '—'))}</td>`).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderUsuarios() {
  const snap = await getDocs(query(collection(db, 'usuarios'), limit(100)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (rows.length === 0) {
    content.innerHTML = emptyPanel('No hay usuarios. Ejecute seed_auth.mjs en back-core.');
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header"><h3>Usuarios — Fuerza de Ventas</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr><th>Código</th><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th></tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.codigoEmpleado || r.codigo || '—')}</td>
                <td>${esc(r.nombre || '—')}</td>
                <td>${esc(r.email || '—')}</td>
                <td><span class="badge neutral">${esc(r.perfil || r.rol || '—')}</span></td>
                <td>${esc(r.estado || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderSolicitudes() {
  const snap = await getDocs(query(collection(db, 'solicitudes_credito'), limit(100)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  solicitudesCache = rows;

  if (rows.length === 0) {
    content.innerHTML = emptyPanel('No hay solicitudes de crédito.');
    return;
  }

  const pendientes = rows.filter((r) => isSolicitudPendiente(r.estado)).length;
  const aprobadas = rows.filter((r) => isSolicitudAprobada(r.estado)).length;

  content.innerHTML = `
    <p class="section-note">
      Evalúe solicitudes desde el core: <strong>Aprobar</strong>, <strong>Condicionar</strong>,
      <strong>Rechazar</strong> o <strong>Desembolsar</strong> (si ya está aprobada).
      Pendientes: ${pendientes} · Aprobadas sin desembolsar: ${aprobadas}
    </p>
    <div class="panel">
      <div class="panel-header"><h3>Solicitudes</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Expediente</th><th>Cliente</th><th>Monto</th><th>Plazo</th>
              <th>Estado</th><th>Aprobado</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.numeroExpediente || r.id)}</td>
                <td>${esc(r.nombres ? `${r.nombres} ${r.apellidos || ''}` : r.clienteId || '—')}</td>
                <td>${money(r.montoSolicitado)}</td>
                <td>${esc(r.plazoMeses)} m</td>
                <td><span class="badge ${badgeForEstado(r.estado)}">${esc(r.estado)}</span></td>
                <td>${money(r.montoAprobado)}</td>
                <td>${renderSolicitudAcciones(r)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderCreditos() {
  const snap = await getDocs(query(collection(db, 'creditos'), limit(100)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  if (rows.length === 0) {
    content.innerHTML = emptyPanel('No hay créditos desembolsados.');
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header"><h3>Créditos desembolsados</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Producto</th><th>Cliente</th><th>Desembolso</th><th>Saldo</th>
              <th>Cuota</th><th>Estado</th><th>Caso</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.producto)}</td>
                <td><code>${esc((r.clienteId || '').slice(0, 16))}</code></td>
                <td>${money(r.montoDesembolsado)}</td>
                <td>${money(r.saldoActual)}</td>
                <td>${money(r.cuotaMensual)}</td>
                <td><span class="badge ${badgeForEstado(r.estado)}">${esc(r.estado)}</span></td>
                <td>${esc(r.casoAcademico ? `#${r.casoAcademico}` : '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderPortal() {
  const [cuentasSnap, clientesCount] = await Promise.all([
    getDocs(query(collection(db, 'cuentas_clientes'), limit(100))),
    countCollection('clientes'),
  ]);

  const cuentas = cuentasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const clientesConPortal = new Set(cuentas.map((c) => c.clienteId).filter(Boolean));
  const sinPortal = Math.max(clientesCount - clientesConPortal.size, 0);

  content.innerHTML = `
    <div class="stats">
      <div class="stat-card"><div class="label">Cuentas activas</div><div class="value">${cuentas.length}</div></div>
      <div class="stat-card"><div class="label">Clientes con portal</div><div class="value">${clientesConPortal.size}</div></div>
      <div class="stat-card"><div class="label">Sin acceso portal</div><div class="value">${sinPortal}</div></div>
    </div>
    ${cuentas.length === 0 ? emptyPanel('No hay cuentas del portal registradas.') : `
    <div class="panel">
      <div class="panel-header"><h3>Cuentas Portal Cliente</h3></div>
      <div style="overflow:auto">
        <table>
          <thead><tr><th>DNI</th><th>Cliente ID</th><th>Activo</th><th>Auth UID</th></tr></thead>
          <tbody>
            ${cuentas.map((c) => `
              <tr>
                <td>${esc(c.numeroDocumento || c.dni || '—')}</td>
                <td><code>${esc(c.clienteId || '—')}</code></td>
                <td><span class="badge ${c.activo !== false ? 'ok' : 'bad'}">${c.activo !== false ? 'Sí' : 'No'}</span></td>
                <td><code>${esc(String(c.authUid || c.id).slice(0, 12))}…</code></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`}`;
}

async function renderCartera() {
  const snap = await getDocs(query(collection(db, 'cartera_diaria'), limit(100)));
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.fechaAsignacion || '').localeCompare(String(a.fechaAsignacion || '')))
    .slice(0, 80);

  if (rows.length === 0) {
    content.innerHTML = emptyPanel('No hay registros de cartera diaria.');
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header"><h3>Cartera diaria</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Fecha</th><th>Cliente</th><th>DNI</th><th>Gestión</th>
              <th>Prioridad</th><th>Visitado</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(formatDate(r.fechaAsignacion))}</td>
                <td>${esc(r.nombreCliente || '—')}</td>
                <td>${esc(r.documento || '—')}</td>
                <td>${esc(r.tipoGestion || '—')}</td>
                <td>${esc(r.prioridad || '—')}</td>
                <td><span class="badge ${r.visitado ? 'ok' : 'warn'}">${r.visitado ? 'Sí' : 'No'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
