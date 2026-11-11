# Instrumentos originales de StudioWav

La biblioteca **F8** incluye cinco instrumentos VST3 para Windows x64 y **40 presets originales**, ocho por instrumento. Elige un preset en la tarjeta y pulsa **Añadir**. El instrumento entra al rack con ese sonido y conserva su estado al guardar y reabrir el proyecto.

Para cambiarlo después, abre **F10 → Efectos VST3**, elige el instrumento en **Plugin para ajustar parámetros** y usa **Preset del instrumento**. También puedes abrir su editor nativo con **Abrir** o desde la ranura del mezclador: incluye selector de presets y controles editables. Cambiar un preset reemplaza los ajustes actuales del instrumento. Guardar el proyecto conserva tus modificaciones.

| Instrumento | Síntesis propia | Presets originales |
| --- | --- | --- |
| StudioWav Piano | Cuerdas inarmónicas con decaimiento y golpe de martillo sintetizado | Studio grand, Soft felt, Bright stage, Long strings, Midnight felt, Glass room, Dry upright, Wide ballad |
| StudioWav Kick | Oscilador con caída de tono, click de ruido y saturación | Round kick, Deep 808, Short punch, Hard drive, Sub floor, Warehouse, Tight electro, Warm tape |
| StudioWav Triple | Tres osciladores con formas seno, sierra, pulso y triángulo; mezcla, afinación y filtro | Wide sunrise, Sub foundation, Arcade pulse, Cloud pad, Fifth avenue, Neon stab, Soft triangle, Copper lead |
| StudioWav FM | Cadena de tres operadores con dos relaciones e índices de modulación, feedback y envolvente de modulación | Crystal keys, Electric velvet, Glass bell, Rubber bass, Metal mallet, Slow aurora, Reed motion, Digital spark |
| StudioWav Pluck | Cuerda pulsada con retardo fraccionario, excitación de ruido y pérdidas en el lazo | Nylon morning, Steel wire, Muted palm, Harp lights, Wood thumb, Warm pizzicato, Glass string, Deep resonator |

Triple, FM y Pluck tienen envolvente ADSR, filtro, 32 voces, velocidad MIDI, sustain CC64 y pitch bend de ±2 semitonos. Piano y Kick conservan sus motores anteriores y los valores de sus primeros cuatro presets. Cada VST3 tiene un identificador propio y estable; el estado de un instrumento no se interpreta como el de otro.

## Instalación independiente

StudioWav incluye estos instrumentos en su portable. No tienes que instalarlos ni mover los plugins de otros programas.

El ZIP **StudioWav-Instruments-0.8.0-VST3.zip** permite utilizarlos en otros hosts VST3 para Windows x64. Extrae la carpeta completa, conserva cada paquete `.vst3` y agrega esa carpeta a la búsqueda de plugins de tu host. En StudioWav se puede explorar una carpeta desde F8. Otros hosts pueden requerir sus ubicaciones estándar de instalación o no admitir carpetas personalizadas. El ZIP incluye las licencias y el manifiesto de los binarios.

Los bancos están incorporados en cada VST3. El archivo `FACTORY_PRESETS.json` documenta sus valores; editar esa copia no modifica el banco del binario. Para crear variaciones, ajusta los controles y guarda el estado en un proyecto del host.

## Referencia y alcance

Son implementaciones independientes de las familias de síntesis que también aparecen en [3x Osc](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/3x%2520Osc.htm), [Fruity DX10](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20DX10.htm) y [Plucked!](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Plucked!.htm). REA inspeccionó las tablas de exportación de las tres DLL instaladas y encontró `CreatePlugInstance`; no encontró una factoría VST3. Esa inspección establece su interfaz exportada y no recupera su algoritmo de sonido.

Estos instrumentos no son los plugins de Image-Line ni prometen el mismo sonido. No incluyen sus presets, gráficos, bancos de muestras ni código y no importan `.fst`, `.fxp` o `.flp`. Triple tiene cuatro formas de onda, sin muestras personalizadas ni todos los modos de 3x Osc; FM tiene una topología fija de tres operadores; Pluck usa un modelo de cuerda propio. La síntesis puede producir aliasing a frecuencias o modulaciones extremas. Todos los presets publicados fueron diseñados para StudioWav.

## Código y verificación

`electron/instruments.json` es el banco único de metadatos y valores. CMake lo incorpora a los binarios con `PresetBank.h`; el catálogo y los selectores de StudioWav leen los mismos nombres. `Instruments.cpp` contiene Piano y Kick y `Synths.cpp` contiene los tres motores nuevos. El script `package-instruments.py` crea el ZIP con sus licencias.

Las comprobaciones nativas verifican temporización MIDI, velocidad, silencio al detener, estado, sustain y respuestas de audio distintas de los ocho presets de cada instrumento. `node scripts/verify-instruments.mjs` carga los VST3 reales en el host y comprueba audio renderizado, parámetros, bypass y recuperación de estado. Las pruebas de Electron verifican añadir instrumentos con un preset elegido y recuperar sus ajustes después de reiniciar.
