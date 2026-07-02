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
  where,
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
    const profile = await loadStaffProfile(user.uid, user.email);
    if (!profile) {
      await signOut(auth);
      loginError.textContent =
        'Autenticación correcta, pero falta el perfil en Firestore. Ejecute scripts/seed_auth.mjs en back-core.';
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
        `Acceso denegado. Su rol es "${rol}". Use 0404-4 (administrador) o 0303-3 (supervisor).`;
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

async function loadStaffProfile(uid, email) {
  const collections = ['asesores_negocio', 'usuarios'];

  for (const col of collections) {
    const direct = await getDoc(doc(db, col, uid));
    if (direct.exists()) return direct.data();
  }

  if (email) {
    for (const col of collections) {
      const byEmail = await getDocs(
        query(collection(db, col), where('email', '==', email), limit(1)),
      );
      if (!byEmail.empty) return byEmail.docs[0].data();
    }
  }

  for (const col of collections) {
    const byUserId = await getDocs(
      query(collection(db, col), where('userId', '==', uid), limit(1)),
    );
    if (!byUserId.empty) return byUserId.docs[0].data();
  }

  return null;
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

  if (rows.length === 0) {
    content.innerHTML = emptyPanel('No hay solicitudes de crédito.');
    return;
  }

  content.innerHTML = `
    <div class="panel">
      <div class="panel-header"><h3>Solicitudes</h3><span>${rows.length} registros</span></div>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>Expediente</th><th>Cliente</th><th>Monto</th><th>Plazo</th>
              <th>Estado</th><th>Aprobado</th><th>Origen</th>
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
                <td>${esc(r.casoAcademico ? `Caso ${r.casoAcademico}` : r.canalOrigen || 'ventas')}</td>
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
