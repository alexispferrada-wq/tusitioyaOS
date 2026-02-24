# 🚀 Guía de Deploy - TuSitioYa OS

## Render.com + Cloudflare + NeonDB

---

## 📋 Pre-Deploy Checklist

### 1. Variables de Entorno Requeridas

Asegúrate de tener estas variables configuradas en Render Dashboard:

```bash
# Base de Datos (Neon PostgreSQL)
DATABASE_URL=postgresql://usuario:password@host.neon.tech/dbname?sslmode=require

# APIs de Inteligencia Artificial
GEMINI_API_KEY=tu_api_key_de_google
GROQ_API_KEY=tu_api_key_de_groq
KIMI_API_KEY=tu_api_key_de_moonshot

# Node Environment
NODE_ENV=production
PORT=10000  # Render asigna automáticamente, no modificar manualmente
```

### 2. Archivos Verificados ✅

- [x] `package.json` - Scripts correctos
- [x] `server.js` - Puerto usa `process.env.PORT`
- [x] `pool` PostgreSQL configurado con SSL
- [x] CORS habilitado
- [x] Static files sirviendo desde `__dirname`
- [x] `.gitignore` - Excluye node_modules y .env

---

## 🚀 Pasos para Deploy en Render

### Paso 1: Crear Web Service en Render

1. Ir a [dashboard.render.com](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Conectar repositorio de GitHub/GitLab
4. Configurar:
   - **Name**: `tusitioya-os` (o tu preferencia)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/mes) o Free (con limitaciones)

### Paso 2: Configurar Variables de Entorno

En el dashboard de tu servicio, ir a "Environment":

```
DATABASE_URL=postgresql://neondb_owner:password@ep-xxx.neon.tech/neondb?sslmode=require
GEMINI_API_KEY=AIzaSy...
GROQ_API_KEY=gsk_...
KIMI_API_KEY=sk-...
NODE_ENV=production
```

⚠️ **IMPORTANTE**: Nunca subas el archivo `.env` a Git. Ya está en `.gitignore`.

### Paso 3: Configurar Base de Datos (Neon)

1. Ir a [neon.tech](https://neon.tech)
2. Crear nuevo proyecto o usar existente
3. Copiar "Connection String" (pegar en `DATABASE_URL` en Render)
4. Ejecutar setup inicial (solo una vez):
   ```bash
   # Localmente, con DATABASE_URL configurada:
   npm run setup
   ```
   O ejecutar el SQL de `setup_db.js` directamente en el SQL Editor de Neon.

### Paso 4: Deploy

1. En Render, hacer click en "Manual Deploy" → "Deploy latest commit"
2. Esperar que termine el build (logs verdes ✅)
3. Verificar que el servicio está "Live"
4. Copiar la URL (ej: `https://tusitioya-os.onrender.com`)

---

## 🌐 Configurar Cloudflare (DNS + SSL)

### Paso 1: Agregar Dominio en Cloudflare

1. Ir a [dash.cloudflare.com](https://dash.cloudflare.com)
2. Agregar sitio (tu dominio: `tusitioya.cl`)
3. Copiar los nameservers de Cloudflare
4. Actualizar nameservers en tu registrador de dominio

### Paso 2: Configurar DNS Records

| Type | Name | Content | TTL | Proxy Status |
|------|------|---------|-----|--------------|
| A | @ | Render IP (obtener de `ping tusitioya-os.onrender.com`) | Auto | Proxied 🟡 |
| A | www | Render IP | Auto | Proxied 🟡 |
| CNAME | dashboard | `tusitioya-os.onrender.com` | Auto | Proxied 🟡 |

### Paso 3: SSL/TLS

1. En Cloudflare → SSL/TLS → Overview
2. Seleccionar **"Full (strict)"**
3. En "Edge Certificates": Activar "Always Use HTTPS"

### Paso 4: Page Rules (Opcional pero recomendado)

Crear regla para forzar HTTPS:
- URL: `http://*tusitioya.cl/*`
- Setting: "Always Use HTTPS" = ON

---

## 🔍 Verificación Post-Deploy

### Tests a realizar:

```bash
# 1. Verificar landing page
curl https://tusitioya.cl/index.html

# 2. Verificar API de clientes
curl https://tusitioya.cl/api/clientes

# 3. Verificar dashboard
curl https://tusitioya.cl/dashboard.html

# 4. Verificar comando central
curl https://tusitioya.cl/previo_comando.html
```

### Logs Importantes en Render:

En Render Dashboard → Logs, verificar:

```
✅ Conexión a Base de Datos establecida
✅ Servidor corriendo en puerto 10000
✅ GEMINI: ONLINE
✅ GROQ: ONLINE
✅ KIMI: ONLINE
```

---

## ⚠️ Solución de Problemas Comunes

### Error: "Puerto ya está en uso"

**Causa**: Múltiples instancias de Node corriendo.  
**Solución**: En `server.js` ya está corregido para usar `process.env.PORT`.

### Error: "No se encontró DATABASE_URL"

**Causa**: Variable de entorno no configurada en Render.  
**Solución**: Ir a Render Dashboard → Environment → Add Environment Variable.

### Error: "Error de SSL al conectar a Neon"

**Causa**: Configuración SSL incorrecta.  
**Solución**: Ya está configurado en `server.js`:
```javascript
ssl: { rejectUnauthorized: false }
```

### Error: "CORS blocked"

**Causa**: Navegador bloqueando requests cross-origin.  
**Solución**: Ya está habilitado `app.use(cors())` en `server.js`.

---

## 📁 Estructura de Archivos Críticos

```
tusitioya.cl/
├── server.js          # ✅ Puerto corregido para Render
├── package.json       # ✅ Scripts y dependencias OK
├── .gitignore         # ✅ Excluye .env y node_modules
├── render.yaml        # ✅ Configuración IaC
├── index.html         # ✅ Landing page (acceso público)
├── dashboard.html     # ✅ Prospector IA (protegido por login)
├── previo_comando.html # ✅ Comando Central (protegido)
├── hoja_ruta.html     # Ruta de proyectos
├── encuesta.html      # Encuesta web
└── node_modules/      # No subir a git
```

---

## 🔒 Seguridad

### Medidas implementadas:

1. **Variables de entorno**: API keys nunca en código
2. **CORS**: Configurado para permitir acceso desde cualquier origen (para APIs)
3. **SSL**: Forzado en Cloudflare + Neon
4. **Login**: Comando Central tiene protección por contraseña
5. **SQL Injection**: Usando parameterized queries en PostgreSQL

---

## 🔄 Actualizaciones Futuras

Para actualizar el código:

```bash
# 1. Hacer cambios localmente
# 2. Commit y push
git add .
git commit -m "Descripción de cambios"
git push origin main

# 3. Render detecta automáticamente y redeploya (autoDeploy: true)
```

---

## 📞 Soporte

Si hay problemas:

1. Revisar logs en Render Dashboard
2. Verificar variables de entorno
3. Probar endpoints individualmente
4. Contactar soporte de Render o revisar documentación oficial

---

**🎉 TuSitioYa OS listo para producción!**
