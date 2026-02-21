# TODO: Análisis Táctico IA - Botones de Acción

## Plan de Implementación

### Archivo: `previo_comando.html`

- [x] **Edit 1 (HTML)**: Reemplazar COLUMNA 2 "Análisis Táctico IA" con:
  - Header mejorado y más prominente
  - Grid de 6 botones de acción IA:
    - 🤝 Quiero cerrar la venta (emerald)
    - 🛡️ Manejar objeciones (blue)
    - 🎯 Es cliente probable (purple)
    - 📞 Primer contacto (teal)
    - 💰 Negociar precio (orange)
    - 🔄 Reactivar lead frío (slate)
  - Separador visual "o analiza manualmente"
  - Textarea reducida (h-28)
  - Botón existente de análisis manual

- [x] **Edit 2 (JS)**: Agregar función `analizarConContexto(tipo, btnEl)` a `App.cliente`
  - Prompts específicos por tipo de acción
  - Loading state en el botón clickeado
  - Resultados en el contenedor `analysis-result` existente

## Estado
- [x] ✅ COMPLETADO
