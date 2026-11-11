# Ecualizador y compresor de canal

Abre **F10 → EQ y compresor**, o selecciona un canal en el mezclador y pulsa **EQ y compresor**. Los mismos controles están disponibles para instrumentos, muestras y buses.

El EQ tiene graves a 120 Hz, una banda de medios con frecuencia ajustable de 160 a 6000 Hz y agudos a 8 kHz. Cada banda permite entre −18 y +18 dB. Los extremos son filtros shelving; la banda de medios es una campana con Q de 0,7.

El compresor ofrece umbral de −60 a 0 dBFS, ratio de 1:1 a 20:1, ataque de 0,1 a 200 ms, liberación de 10 a 2000 ms y ganancia de salida de 0 a 24 dB. El medidor muestra la reducción real calculada por el procesador. La detección enlaza los dos canales: un pico de cualquiera de ellos aplica la misma reducción a ambos y conserva su balance estéreo.

Cada efecto tiene bypass independiente. Desactivarlo conserva sus ajustes; **Restablecer efectos** recupera los valores iniciales y desactiva ambos. Los presets propios **Bajo definido**, **Batería compacta** y **Compresión suave** son puntos de partida editables. Cada cambio se puede deshacer y queda incluido en el archivo `.studiowav` y el guardado local. Los proyectos anteriores mantienen ambos efectos desactivados.

Abre [Mezcla con efectos.studiowav](<../examples/Mezcla con efectos.studiowav>) para probarlos con los instrumentos propios StudioWav Piano y StudioWav Kick.

## Procesamiento

La cadena es: generador o entrada del bus → VST3 → EQ → compresor → retardo manual, filtro, volumen y panorama del canal → salidas y envíos. El delay musical recibe la señal procesada. La exportación WAV y la grabación del master incluyen estos efectos; MIDI transporta las notas y no contiene la mezcla.

El EQ nativo utiliza los filtros IIR de JUCE; sus bandas corresponden a las fórmulas shelving y peaking del [Audio EQ Cookbook de W3C](https://www.w3.org/TR/audio-eq-cookbook/). Los estados de filtro son independientes para izquierda y derecha. Al reducir la frecuencia de muestreo, las frecuencias de las bandas se limitan al 45 % de ella para mantenerlas por debajo de Nyquist.

El compresor es una implementación propia de rodilla dura, sin anticipación ni ganancia automática. Convierte el pico estéreo a dB, calcula la reducción según el umbral y ratio y la suaviza con los tiempos de ataque y liberación. La ganancia de salida se aplica después. No añade búferes de latencia. La versión de navegador utiliza la misma ley de compresión en un AudioWorklet; el motor C++ procesa las muestras directamente. La cadena completa puede diferir entre backends por sus sintetizadores, filtros y limitador de salida.

Estos controles no están automatizados en esta versión. El compresor controla la dinámica, pero no sustituye a un limitador de picos: ajustes rápidos o realce de EQ pueden producir saturación. El medidor no presenta una reducción ficticia cuando está en bypass.

## Verificación

`node scripts/verify-channel-effects.mjs` mide el renderizador nativo con señales originales conocidas: respuesta de cada banda, bypass con PCM idéntico, compresión estática, balance estéreo, ganancia de salida, diferencias de ataque y liberación, procesamiento de buses y medidor en reproducción. También comprueba el rechazo de parámetros inválidos.

Las pruebas de navegador editan los controles, guardan y reabren el proyecto, deshacen cambios y comparan audio WAV con los efectos activos y en bypass. `node scripts/verify-effects-desktop.mjs` verifica la interfaz Electron con el motor nativo, el medidor, la amplitud exportada y la recuperación de ajustes después de reiniciar. Acepta opcionalmente la ruta al ejecutable empaquetado.
