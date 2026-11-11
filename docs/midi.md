# Intercambio de archivos MIDI

En **Archivo → Importar MIDI…** puedes seleccionar un archivo `.mid` o `.midi`. También puedes arrastrarlo al espacio de trabajo. El panel muestra sus partes y permite añadir las seleccionadas al proyecto o crear uno nuevo. Elige el compás de inicio y si quieres adoptar su tempo.

Las partes importadas crean canales independientes. Sus notas aparecen en el Piano Roll, y una pista nueva de Playlist contiene los patrones del archivo. La importación completa se deshace con Ctrl+Z; cancelar o rechazar un archivo inválido conserva el proyecto actual y los estados de sus plugins.

**Archivo → Exportar patrón MIDI…** exporta el patrón seleccionado. **Exportar canción MIDI…** sigue el arreglo: clips, bucles, silencio de pistas, mute/solo y swing. MIDI no contiene el sonido de los instrumentos, los plugins ni las muestras; para conservar la mezcla audible utiliza WAV.

## Compatibilidad

- Lectura de Standard MIDI File tipos 0 y 1 con división PPQ. La exportación utiliza tipo 1 y 960 pulsos por negra, una pista de tempo y una por instrumento audible.
- Notas, velocidades y duraciones. Note On con velocidad cero actúa como Note Off. Se admite running status.
- Programas GM conservados como metadatos de exportación. Los sonidos iniciales de StudioWav son aproximaciones, no un banco General MIDI completo.
- La batería del canal MIDI 10 se separa por voz. Kick, caja, clap y hi-hats reciben instrumentos iniciales correspondientes; otras voces utilizan una percusión provisional identificada por su número GM. Internamente se normaliza la altura para que funcione con instrumentos de batería afinados a Do4. Al exportar vuelve al número GM de esa voz; la afinación por nota de percusión no se transmite como cambio de timbre GM.
- El pedal CC64 se convierte en duración de notas. Se procesan también All Notes Off, All Sound Off y Reset All Controllers. Otros controladores, pitch bend, presión y SysEx se omiten con aviso.
- Se exportan hasta 32 canales melódicos usando puertos MIDI virtuales y reservando el canal 10 para percusión. La aplicación receptora debe interpretar el evento de puerto MIDI para distinguir más de quince instrumentos melódicos simultáneos.

## Límites visibles

La lectura admite hasta 8 MB, 128 pistas de archivo, 128 partes/variantes de voz, 200 000 eventos, 32 768 notas y 64 compases en la rejilla 4/4 del proyecto. Solo las partes seleccionadas consumen canales del proyecto; el límite sigue siendo 32, incluyendo buses. Una parte puede contener como máximo 2048 notas por bloque de ocho compases. Los archivos que exceden estas capacidades se rechazan antes de cambiar el proyecto.

StudioWav usa un tempo fijo. El panel avisa si el archivo contiene cambios posteriores de tempo o un compás diferente de 4/4. Al conservar el proyecto existente, los canales nuevos reciben su swing actual; crear uno nuevo parte sin swing. Los formatos tipo 2 y el tiempo SMPTE se rechazan explícitamente.

Las notas se ajustan a la resolución mínima de 1/64 de paso si es necesario. Los archivos largos se colocan en bloques de hasta ocho compases. Una nota que cruza uno de esos límites se divide y se rearticula; el panel lo anuncia antes de importar.

## Verificación

Las pruebas usan bytes SMF escritos manualmente, lectura y escritura independientes de JUCE, edición real en navegador y reproducción con el motor C++ desde Electron. `node scripts/verify-midi.mjs` comprueba un archivo creado por JUCE, verifica el archivo exportado mediante ese lector independiente y renderiza las notas importadas a PCM. `node scripts/verify-midi-desktop.mjs` verifica importar, reproducir, exportar y deshacer desde la interfaz de escritorio.

Referencias de formato: [MIDI Association: Standard MIDI Files](https://midi.org/standard-midi-files), [Microsoft: running status](https://learn.microsoft.com/en-us/windows/win32/multimedia/receiving-running-status-messages) y el lector `MidiFile` de JUCE 8.0.12 incluido durante la preparación del proyecto.
