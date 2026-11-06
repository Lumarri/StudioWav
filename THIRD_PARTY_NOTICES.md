# Dependencias de StudioWav

El código propio de StudioWav se publica bajo **AGPL-3.0-only**, con el texto completo en [LICENSE](LICENSE). Las dependencias mantienen sus propios derechos, licencias y avisos.

El backend y los instrumentos usan [JUCE 8.0.12](https://github.com/juce-framework/JUCE/tree/8.0.12) bajo su opción **AGPLv3**. Su [licencia e inventario de dependencias](https://github.com/juce-framework/JUCE/blob/8.0.12/LICENSE.md) se descargan en native/vendor/JUCE-8.0.12/LICENSE.md durante la preparación.

La preparación fija JUCE-8.0.12.zip, SHA-256 91ceb4b54f9cc763884f6285fcfee4372fbe72d33061a339255cee2957e34ad8.

JUCE incluye encabezados ASIO de Steinberg bajo licencia dual; esta distribución abierta utiliza la opción **GPLv3**. El texto completo de GPLv3 se conserva en [licenses/GPL-3.0-only.txt](licenses/GPL-3.0-only.txt). El SDK VST3 incluido en esta versión de JUCE utiliza MIT. Sus avisos están en modules/juce_audio_devices/native/asio/ y modules/juce_audio_processors_headless/format_types/VST3_SDK/. Los decodificadores y componentes gráficos incorporados están enumerados en la licencia de JUCE y conservan sus avisos individuales.

Electron (MIT y avisos de Chromium), React (MIT), Vite (MIT), TypeScript (Apache-2.0) y Lucide (ISC) conservan sus licencias en node_modules. Electron Builder incluye los avisos de Electron y Chromium en la distribución. Los compiladores Microsoft y el SDK de Windows se utilizan para compilar y no se distribuyen con la aplicación ni con el repositorio.

El proceso de compilación recopila los avisos de JUCE y sus componentes en native/bin/licenses y añade los textos AGPLv3 y GPLv3. El portable los incluye en resources/licenses. El código fuente de esta versión y sus instrucciones de compilación están disponibles en https://github.com/Lumarri/StudioWav.

Los drivers y plugins elegidos por el usuario pertenecen a sus proveedores. El portable no incluye FL Studio, sus plugins ni sus recursos.
