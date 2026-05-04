# Guía de Despliegue y Replicación

Este documento explica paso a paso cómo poner a funcionar este proyecto en un entorno local y cómo desplegarlo a producción.

Al ser una aplicación **Frontend pura (estática)** sin necesidad de backend o base de datos externa, su despliegue y replicación son extremadamente sencillos.

## 1. Replicación Local (Desarrollo y Pruebas)

Para ejecutar este proyecto en tu propia máquina, solo necesitas servir los archivos estáticos. 

### Opción A: Usando Live Server (Recomendado)
1. Instala el editor [Visual Studio Code](https://code.visualstudio.com/).
2. Abre la carpeta del proyecto en VS Code.
3. Ve a la sección de Extensiones y busca "Live Server" de Ritwick Dey. Instálala.
4. Haz clic derecho sobre el archivo `index.html` y selecciona **"Open with Live Server"**.
5. Se abrirá una pestaña en tu navegador en una dirección como `http://127.0.0.1:5500/index.html`.

### Opción B: Usando Node.js / npx
1. Asegúrate de tener Node.js instalado.
2. Abre tu terminal en el directorio del proyecto.
3. Ejecuta el siguiente comando para iniciar un servidor estático ligero:
   ```bash
   npx serve .
   ```
4. Abre la dirección web que se muestra en tu terminal (generalmente `http://localhost:3000`).

### Opción C: Usando Python
Si tienes Python instalado, puedes levantar un servidor temporal nativo:
1. Abre tu terminal en el directorio del proyecto.
2. Ejecuta:
   ```bash
   python -m http.server 8000
   ```
3. Visita `http://localhost:8000`.

*(Nota: Aunque abrir directamente el archivo `index.html` con doble clic funcionará para la mayoría de las funcionalidades, el Service Worker (necesario para el comportamiento PWA y offline) requiere estrictamente ser servido desde un entorno `http://` (localhost) o `https://` para registrarse correctamente por razones de seguridad del navegador).*

## 2. Despliegue a Producción (Hosting)

Puedes alojar este proyecto permanentemente en cualquier servicio de hosting estático de forma gratuita (Vercel, Netlify, GitHub Pages, o Firebase Hosting).

### Opción 1: Despliegue con Vercel o Netlify (Recomendado)
1. Sube esta carpeta a un repositorio en **GitHub**, **GitLab** o **Bitbucket**.
2. Entra en [Vercel](https://vercel.com/) o [Netlify](https://www.netlify.com/) e inicia sesión vinculando tu cuenta de GitHub.
3. Haz clic en "Añadir Nuevo Sitio" (o "Add new site").
4. Autoriza a la plataforma a leer tus repositorios y selecciona el repositorio del Gestor de Contraseñas.
5. Los ajustes predeterminados de "Build" son correctos (no es necesario ejecutar ningún comando de build ya que es Vanilla JS).
6. Haz clic en **Deploy**. En menos de 1 minuto tendrás una URL pública, rápida y con un certificado SSL seguro instalado.

### Opción 2: Despliegue en GitHub Pages
1. Sube tu proyecto a un repositorio en GitHub.
2. Ve a los **Settings** (Configuración) de ese repositorio en la web de GitHub.
3. En la barra lateral izquierda, busca y haz clic en **Pages**.
4. En "Source", selecciona la rama principal (suele ser `main` o `master`) y la carpeta `/ (root)`.
5. Haz clic en **Save**. En un par de minutos, tu sitio estará disponible globalmente en `https://[tu-usuario].github.io/[tu-repositorio]`.

## 3. Configuración Adicional: Sincronización con Google Drive (Avanzado)

Si deseas activar el botón de sincronización (para guardar copias de seguridad de tu bóveda cifrada en Google Drive) a partir del código esqueleto en `js/gdrive-sync.js`, debes seguir estos pasos para autorizar tu aplicación ante Google.

1. Ve a la [Google Cloud Console](https://console.cloud.google.com/).
2. Crea un **Nuevo Proyecto**.
3. En el menú lateral izquierdo ve a "APIs y Servicios" -> "Pantalla de consentimiento de OAuth".
   * Selecciona "Externo" y llena los datos obligatorios requeridos (nombre de la aplicación, tu correo electrónico de contacto).
4. Ve a "Credenciales" en el menú izquierdo y haz clic en "Crear Credenciales" -> **ID de cliente de OAuth**.
5. Selecciona el tipo de aplicación como **Aplicación Web**.
6. En la sección **Orígenes de JavaScript autorizados**, debes añadir las URLs exactas desde donde vas a ejecutar la aplicación:
   * Si pruebas en local con Live Server: `http://127.0.0.1:5500`
   * Si lo desplegaste en Vercel/Netlify: Tu dominio público (ej. `https://mi-gestor-claves.vercel.app`)
7. Haz clic en "Crear". Aparecerá una ventana con un **Client ID**; cópialo.
8. En tu código fuente, abre `js/gdrive-sync.js` y reemplaza la cadena `'TU_CLIENT_ID_AQUI.apps.googleusercontent.com'` por tu Client ID copiado.
9. Finalmente, para que Google Identity funcione, en el archivo `index.html` (preferiblemente dentro de `<head>`), deberás añadir el script oficial de Google:
   ```html
   <script src="https://accounts.google.com/gsi/client" async defer></script>
   ```

*Para completar la lógica en `gdrive-sync.js`, deberás revisar la documentación de la **API de Google Drive v3 para JavaScript** e implementar funciones para subir (POST) y descargar (GET) el string cifrado contenido en tu localStorage.*
