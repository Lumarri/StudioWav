# Referencias funcionales y origen del código

StudioWav es una implementación independiente de un DAW por patrones. La interfaz, el motor de mezcla, los instrumentos y las herramientas musicales tienen código fuente propio en este repositorio. No es un producto de Image-Line ni está afiliado a esa empresa.

Durante el desarrollo se utilizó [REA](https://github.com/morluto/rea) sobre una instalación local de FL Studio 2025 para estudiar estructuras, formularios y formatos de plugins. Los controles observados orientaron funciones como el arpegiador, cuantizador, articulador, clips de patrón y síntesis de kick. La descompilación global del motor de FL no terminó; no se recuperaron sus algoritmos DSP.

Se distinguieron dos tipos de evidencia:

- Las tablas de exportación y los recursos estáticos permiten identificar interfaces, nombres de controles y valores serializados. No establecen una fórmula DSP ni prueban el comportamiento en ejecución.
- Las pruebas de StudioWav verifican sus algoritmos propios mediante eventos MIDI, audio PCM, parámetros, guardado de estado y flujos de la interfaz Electron.

Las DLL locales de FL Keys y Fruit Kick declaran la entrada nativa `CreatePlugInstance`. El host de este proyecto carga VST3 mediante `GetPluginFactory`; no implementa el formato de plugins nativos Fruity. Mover o renombrar esas DLL no proporciona esa compatibilidad.

**StudioWav Piano** sintetiza parciales de cuerda con decaimiento, transitorio de martillo y respuesta a velocidad y pedal. **StudioWav Kick** combina un barrido de frecuencia, envolvente de amplitud, clic y saturación. Sus escalas y presets son propios. No contienen muestras, código ni bibliotecas de los instrumentos de FL Studio y no afirman equivalencia sonora con ellos.

Este repositorio contiene el código redistribuible y un proyecto musical propio. Los binarios analizados, recursos extraídos, capturas de otras aplicaciones y registros locales de investigación no forman parte de la publicación.
