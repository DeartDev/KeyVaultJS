# Gestor de Contraseñas (Password Manager)

Una aplicación web de gestión de contraseñas de alta seguridad, construida con Vanilla JavaScript, HTML y CSS. Utiliza criptografía local ("Zero-Knowledge") mediante la Web Crypto API del navegador para asegurar que tus datos nunca sean legibles sin tu PIN maestro.

## Características Principales

*   **Seguridad Zero-Knowledge**: Tus contraseñas se encriptan localmente con AES-GCM (256 bits). La clave maestra deriva de tu PIN mediante PBKDF2.
*   **Diseño Premium**: Interfaz moderna con efectos *Glassmorphism*, animaciones suaves y modo oscuro. Totalmente responsiva.
*   **Soporte PWA (Progressive Web App)**: Instalable en dispositivos móviles y de escritorio, con soporte completo para funcionar *offline* sin conexión a internet.
*   **Generador Integrado**: Herramienta integrada para generar contraseñas súper seguras (combinando letras, números y símbolos aleatorios).
*   **Auto-bloqueo**: Cierre automático de sesión tras 5 minutos de inactividad para proteger tu bóveda.

## Estructura del Proyecto

*   `/css/styles.css`: Estilos de la aplicación.
*   `/js/app.js`: Controlador y lógica de la interfaz.
*   `/js/crypto.js`: Lógica de cifrado nativo.
*   `/js/storage.js`: Lógica de persistencia en Local Storage.
*   `/js/generator.js`: Lógica para generar contraseñas fuertes.
*   `/js/gdrive-sync.js`: Preparación para integración con Google Drive (requiere configuración manual).
*   `.specs/`: Especificación técnica del MVP y planes de desarrollo.
*   `.docs/`: Documentación adicional para replicar y desplegar el proyecto.

## Documentación

Para instrucciones detalladas sobre cómo ejecutar, desplegar y replicar este proyecto, por favor consulta la carpeta `.docs/`.
