# Desplegar Front Core en Vercel (gratis)

Panel administrativo estático (HTML + JS). Sin build ni Node en producción.

## Repo

https://github.com/75535671-eng/front-core

---

## Paso 1 — Cuenta Vercel

1. https://vercel.com/signup
2. Conecta **GitHub**

---

## Paso 2 — Importar proyecto

1. **Add New…** → **Project**
2. Importa **`75535671-eng/front-core`**
3. Configuración:

| Campo | Valor |
|-------|--------|
| **Framework Preset** | **Other** |
| **Root Directory** | `./` (raíz del repo) |
| **Build Command** | *(dejar vacío)* |
| **Output Directory** | *(dejar vacío o `.`)* |
| **Install Command** | *(dejar vacío)* |

4. **Deploy**

Tu URL será algo como:

**`https://front-core-xxxxx.vercel.app`**

(o el nombre que elijas en el proyecto)

---

## Paso 3 — Firebase Auth (obligatorio para login)

Si no haces esto, el login fallará en Vercel.

1. [Firebase Console](https://console.firebase.google.com/) → **`caja-cusco-ventas`**
2. **Authentication** → **Settings** → **Authorized domains**
3. **Add domain** → pega tu dominio Vercel, por ejemplo:
   - `front-core.vercel.app`
   - o el subdominio exacto que te asignó Vercel

Guarda y prueba de nuevo el login.

---

## Paso 4 — Firestore rules (admin/supervisor)

El panel lee Firestore directo desde el navegador. Las reglas deben estar desplegadas:

```powershell
cd back-core
firebase deploy --only firestore:rules --project caja-cusco-ventas
```

Sin esto, algunas vistas (cartera, portal) pueden dar error de permisos.

---

## Paso 5 — Probar

1. Abre tu URL de Vercel
2. Login con administrador o supervisor:
   - `0404-4@cajacusco.com`
   - contraseña de Firebase Auth

---

## Backend en Render (opcional)

El panel **no requiere** la API de Render para funcionar (usa Firestore directo).

Si más adelante conectas la API:

**https://cajacusco-back-core.onrender.com**

---

## Actualizar el front

```powershell
git push origin main
```

Vercel redeploy automático.

---

## Plan Free Vercel

- Gratis para sitios estáticos
- HTTPS automático
- Sin cold start fuerte (a diferencia de Render free)
- Ideal para el panel admin académico

---

## Problemas frecuentes

| Problema | Solución |
|----------|----------|
| Login no funciona | Agregar dominio Vercel en Firebase → Authorized domains |
| Pantalla en blanco | Revisar consola del navegador (F12) |
| Error permisos Firestore | Desplegar `firestore.rules` y usar usuario admin/supervisor |
| 404 en rutas | `vercel.json` con rewrite a `index.html` (ya incluido) |
