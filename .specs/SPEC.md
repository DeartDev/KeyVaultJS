# Especificación del Proyecto: Gestor de Contraseñas (Password Manager)

Basado en la historia de usuario proporcionada, a continuación se detalla la especificación y el plan de implementación del proyecto. 

## Historia de Usuario Principal
> "Como usuario quiero acceder a una plataforma con una contraseña/pin donde una vez validado pueda ver/crear/editar/eliminar/administrar mis contraseñas de acuerdo a las plataformas que utilice, las contraseñas deben estar hasheadas para poder verlas debo seleccionlar la plataforma/contraseña que quiero ver."

## 1. Alcance y Características Principales (MVP - Producto Mínimo Viable)

### 1.1. Autenticación Principal
*   **Acceso:** El usuario debe ingresar mediante un PIN o Contraseña Maestra (Master Password).
*   **Seguridad:** Solo tras la validación exitosa se otorgará acceso a la bóveda de contraseñas.
*   **Sin Recuperación:** Por máxima seguridad, si el usuario olvida el PIN/Contraseña Maestra, los datos no se pueden recuperar.
*   **Auto-bloqueo:** La aplicación se bloqueará automáticamente pidiendo el PIN tras un tiempo sin uso (configurable por el usuario).

### 1.2. Gestión de Contraseñas (CRUD)
*   **Crear:** Añadir nuevas credenciales especificando: Nombre de la Plataforma/Servicio, Nombre de Usuario/Email, y la Contraseña.
*   **Leer (Ver):** Listar todas las plataformas guardadas. Al seleccionar una, permitir la visualización de la contraseña desencriptada.
*   **Editar:** Modificar datos de una credencial existente.
*   **Eliminar:** Borrar credenciales que ya no se necesiten.
*   **Generador de Contraseñas:** Se incluirá una herramienta para generar contraseñas seguras automáticamente al crear o editar un registro.

### 1.3. Seguridad y Cifrado
*   **Encriptación Simétrica:** Se usará AES-GCM (mediante la Web Crypto API nativa del navegador) para cifrar las contraseñas.
*   **Zero-Knowledge:** Se utiliza el PIN/Contraseña Maestra del usuario, procesada con una función de derivación de claves (PBKDF2 vía Web Crypto API), para generar la clave maestra de encriptación. 
*   **Visualización Protegida:** Las contraseñas aparecerán ocultas por defecto en la interfaz (ej. `••••••••`).

## 2. Decisiones Técnicas y Arquitectura

### 2.1. Stack Tecnológico
*   **Frontend:** Vanilla JavaScript (ES6+), HTML5, y CSS3 puro. Se priorizará un diseño premium, moderno y dinámico (paletas de color cuidadosamente elegidas, animaciones suaves, efectos tipo glassmorphism).
*   **PWA (Progressive Web App):** Se configurará un `manifest.json` y un `service-worker.js` para permitir la instalación en dispositivos (móvil y escritorio) y habilitar el funcionamiento offline.

### 2.2. Almacenamiento y Sincronización
*   **Almacenamiento Local:** Las contraseñas se guardarán de forma persistente pero cifrada en el dispositivo usando `localStorage`.
*   **Sincronización:** Integración con la **API de Google Drive**. La base de datos local cifrada se podrá respaldar (exportar) y restaurar (importar) desde un archivo oculto en el Google Drive del usuario, permitiendo la sincronización manual entre dispositivos sin necesidad de mantener un servidor propio.

## 3. Cambios Propuestos (Archivos a crear)

El proyecto se construirá en el directorio de trabajo actual.

### Frontend y Estructura Base

#### `index.html`
Archivo principal con la estructura de la aplicación (Pantalla de Login, Dashboard de contraseñas, Modales para el CRUD y Configuración).

#### `styles.css`
Estilos de la aplicación. Se implementará un diseño moderno y fluido.

#### `app.js`
Lógica principal de la aplicación, manejo del DOM, enrutamiento básico (vistas), y manejo de eventos.

### Módulos de Lógica (JavaScript)

#### `crypto.js`
Módulo encargado de interactuar con la Web Crypto API. Contendrá funciones para derivar la clave maestra desde el PIN, y cifrar/descifrar el almacén de datos.

#### `storage.js`
Módulo para interactuar con `localStorage`. Manejará el guardado y carga de la bóveda de contraseñas (siempre en estado cifrado).

#### `gdrive-sync.js`
Módulo para manejar la autenticación con Google Identity Services y las peticiones a la API de Google Drive para respaldar/restaurar datos.

#### `generator.js`
Funciones para generar contraseñas aleatorias seguras en base a parámetros (longitud, símbolos, etc.).

### PWA

#### `manifest.json`
Manifiesto para hacer la aplicación instalable en el sistema.

#### `service-worker.js`
Service worker para cachear los archivos estáticos y permitir carga offline.

## 4. Plan de Verificación

### Pruebas Manuales a realizar:
1.  **Cifrado Local:** Inspeccionar el `localStorage` en el navegador para confirmar que los datos están completamente cifrados y son ilegibles sin la aplicación funcionando con el PIN correcto.
2.  **Flujo CRUD:** Crear, ver, editar y eliminar una contraseña de prueba.
3.  **Bloqueo por Inactividad:** Esperar el tiempo configurado y confirmar que la sesión se cierra automáticamente.
4.  **Generador:** Generar contraseñas y probar que cumplen con los requisitos (símbolos, longitud).
5.  **Offline y PWA:** Simular la falta de red y verificar que la aplicación puede seguir leyendo/escribiendo contraseñas de forma local.
6.  **Sincronización:** (Requerirá credenciales de Google Cloud creadas por ti, el usuario). Probaremos conectar la cuenta, subir el respaldo cifrado y descargarlo en una sesión limpia.
