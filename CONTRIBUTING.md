# Contribuir a StudioWav

Gracias por contribuir. Abre un issue para describir un problema o una mejora y envía los cambios mediante una pull request.

## Preparación

La aplicación de escritorio y el motor nativo se desarrollan en Windows x64. Consulta [README.md](README.md) para instalar las dependencias. La interfaz de compatibilidad, las pruebas de modelo y la compilación web también pueden ejecutarse en otros sistemas con Node.js 24 o posterior.

Antes de enviar cambios ejecuta `npm test` y `npm run build`. Para cambios de interfaz, ejecuta además `npm run test:e2e`. Para cambios de audio, compila el backend y ejecuta `npm run test:native` y los verificadores correspondientes a los instrumentos o al host.

Describe qué comportamiento cambia y cómo lo verificaste. Las pruebas con dispositivos físicos deben identificar el sistema y el dispositivo utilizados; una prueba con datos sintéticos no sustituye esa comprobación.

## Código y recursos

El código propio se distribuye bajo AGPL-3.0-only. Al enviar contribuciones, mantén esa licencia y los avisos de sus dependencias. Añade únicamente código y recursos que puedas redistribuir. Conserva las licencias de cualquier dependencia nueva.

No incluyas plugins comerciales, DLL de terceros, capturas privadas, credenciales, grabaciones personales ni proyectos de otros programas. Los instrumentos y las muestras de prueba deben ser propios o tener una licencia compatible y documentada.
