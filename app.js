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
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
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

document.getElementById('loginBtn').addEventListener('click', async () => {
  loginError.classList.add('hidden');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    loginError.textContent = 'No se pudo iniciar sesión. Verifique correo y contraseña.';
    loginError.classList.remove('hidden');
  }
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

  const profile = await loadStaffProfile(user.uid);
  if (!profile || !isAdminOrSupervisor(profile)) {
    await signOut(auth);
    loginError.textContent =
      'Acceso denegado. Solo administrador o supervisor pueden usar el core web.';
    loginError.classList.remove('hidden');
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    return;
  }

  currentUser = { ...user, profile };
  userChip.textContent = `${profile.nombre || user.email} · ${profile.rol || profile.perfil}`;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  renderView();
});

async function loadStaffProfile(uid) {
  const userDoc = await getDoc(doc(db, 'usuarios', uid));
  if (userDoc.exists()) return userDoc.data();
  const asesorDoc = await getDoc(doc(db, 'asesores_negocio', uid));
  if (asesorDoc.exists()) return asesorDoc.data();
  return null;
}

function isAdminOrSupervisor(profile) {
  const rol = (profile.perfil || profile.rol || '').toString();
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

function esc(text) {
  const d = document.createElement('div');
  d.textContent = text ?? '';
  return d.innerHTML;
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
        await renderTable('usuarios', ['codigoEmpleado', 'nombre', 'email', 'rol', 'estado']);
        break;
      case 'cartera':
        await renderCartera();
        break;
      default:
        content.innerHTML = '<p>Vista no disponible.</p>';
    }
  } catch (e) {
    content.innerHTML = `<p class="error">Error al cargar datos: ${esc(e.message)}</p>`;
  }
}

async function countCollection(name) {
  const snap = await getDocs(query(collection(db, name), limit(500)));
  return snap.size;
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

async function renderSolicitudes() {
  const snap = await getDocs(query(collection(db, 'solicitudes_credito'), limit(100)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
                <td><span class="badge ok">${esc(r.estado)}</span></td>
                <td>${esc(r.casoAcademico ? `#${r.casoAcademico}` : '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderPortal() {
  const [cuentasSnap, clientesSnap] = await Promise.all([
    getDocs(query(collection(db, 'cuentas_clientes'), limit(100))),
    getDocs(query(collection(db, 'clientes'), limit(100))),
  ]);

  const cuentas = cuentasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const clientesConPortal = new Set(cuentas.map((c) => c.clienteId));
  const clientesTotal = clientesSnap.size;
  const sinPortal = clientesTotal - clientesConPortal.size;

  content.innerHTML = `
    <div class="stats">
      <div class="stat-card"><div class="label">Cuentas activas</div><div class="value">${cuentas.length}</div></div>
      <div class="stat-card"><div class="label">Clientes con portal</div><div class="value">${clientesConPortal.size}</div></div>
      <div class="stat-card"><div class="label">Sin acceso portal</div><div class="value">${Math.max(sinPortal, 0)}</div></div>
    </div>
    <div class="panel">
      <div class="panel-header"><h3>Cuentas Portal Cliente</h3></div>
      <div style="overflow:auto">
        <table>
          <thead><tr><th>DNI</th><th>Cliente ID</th><th>Activo</th><th>Auth UID</th></tr></thead>
          <tbody>
            ${cuentas.map((c) => `
              <tr>
                <td>${esc(c.numeroDocumento)}</td>
                <td><code>${esc(c.clienteId)}</code></td>
                <td><span class="badge ${c.activo ? 'ok' : 'bad'}">${c.activo ? 'Sí' : 'No'}</span></td>
                <td><code>${esc((c.authUid || c.id).slice(0, 12))}…</code></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function renderCartera() {
  const snap = await getDocs(
    query(collection(db, 'cartera_diaria'), orderBy('fechaAsignacion', 'desc'), limit(80)),
  );
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
                <td>${esc(r.fechaAsignacion)}</td>
                <td>${esc(r.nombreCliente)}</td>
                <td>${esc(r.documento)}</td>
                <td>${esc(r.tipoGestion)}</td>
                <td>${esc(r.prioridad)}</td>
                <td><span class="badge ${r.visitado ? 'ok' : 'warn'}">${r.visitado ? 'Sí' : 'No'}</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
