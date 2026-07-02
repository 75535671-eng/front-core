# Front Core — Caja Cusco

Panel web administrativo unificado (**Fuerza de Ventas + Portal Cliente**). Lee Firestore del proyecto **`caja-cusco-ventas`**.

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `index.html` | Shell del panel |
| `app.js` | Auth Firebase + consultas Firestore |
| `styles.css` | Estilos (tema oscuro) |
| `firebase-config.js` | Config del proyecto Firebase |

## Ejecutar en local

Con Firebase CLI (desde la carpeta `public` o con `firebase.json` en la raíz del repo):

```powershell
firebase serve --only hosting --project caja-cusco-ventas
```

Abre **http://localhost:5000**

Alternativa sin Firebase CLI: cualquier servidor estático (Live Server, `npx serve .`, etc.).

## Login

Solo **administrador** o **supervisor** (`usuarios` en Firestore).

Ejemplo: `0404-4@cajacusco.com` + contraseña de Firebase Auth.

## Despliegue

```powershell
firebase deploy --only hosting --project caja-cusco-ventas
```

## Relación con otros repos

- App móvil ventas: `cajacusco-fuerza-de-venta`
- App móvil clientes: `cajacusco-cliente`
- Copia embebida en el repo ventas: `CAJACUSCO-VENTAS/core-admin/public/`
