# Resumen del Proyecto: "Mejorador de Flujos de Venta con IA"

Este proyecto es un ecosistema digital completo diseñado para potenciar las operaciones de una agencia de software (Aexon). Su objetivo es automatizar y optimizar todo el ciclo de ventas, desde la captación de clientes hasta la gestión de proyectos y la prospección activa, utilizando la inteligencia artificial como pilar central.

El sistema se divide en tres componentes principales:

---

### 1. Landing Page (`index.html`) - La Vitrina Digital

Es la cara pública de la agencia, diseñada para atraer y convertir visitantes en clientes potenciales.

*   **Propósito:**
    *   Presentar los servicios de desarrollo web y software (Planes Emprendedor, Pyme, etc.).
    *   Demostrar capacidad y autoridad técnica mostrando el stack tecnológico (Node.js, Neon DB, Gemini AI).
    *   Generar confianza y urgencia a través de elementos dinámicos como el "Monitor de Red" y el contador de "Cupos Disponibles".

*   **Funcionamiento:**
    *   Actúa como un embudo de marketing que dirige a los interesados a un contacto directo por WhatsApp para iniciar el ciclo de venta.

---

### 2. Comando Central (`previo_comando.html`) - El Cerebro Operativo

Este es el CRM interno de alta velocidad, donde se gestiona el día a día de las operaciones una vez que un lead es capturado.

*   **Propósito:**
    *   Centralizar la gestión de todos los leads y clientes, eliminando la necesidad de Excels o notas dispersas.
    *   Proporcionar una visión 360° de cada cliente en una única "Ficha".
    *   Acelerar el proceso de venta con herramientas de IA y automatización.

*   **Características Clave:**
    *   **Dashboard Financiero:** Métricas en tiempo real sobre ventas, proyecciones de cobro y caja.
    *   **Ficha de Cliente Unificada:** Contiene datos de contacto, historial de conversaciones, estado financiero, y progreso del proyecto.
    *   **Asistente de Cierre IA:** Analiza el historial de chat con un cliente y genera respuestas persuasivas basadas en psicología de ventas para manejar objeciones o cerrar tratos.
    *   **Modo Focus (Discador):** Una interfaz simplificada que guía al vendedor para contactar a los leads uno tras otro, sin distracciones.
    *   **Hoja de Ruta del Proyecto:** Un panel donde el cliente puede ver el avance de su web en tiempo real.

---

### 3. Buscador de Clientes IA (`dashboard.html`) - El Motor de Prospección

Esta es la herramienta más avanzada del ecosistema. Su función no es gestionar clientes existentes, sino **encontrar clientes nuevos de forma proactiva**.

*   **Propósito:**
    *   Automatizar la búsqueda y calificación de leads B2B o B2C.
    *   Permitir al usuario "entrenar" a la IA para que refine sus búsquedas con el tiempo.
    *   Transformar una idea de cliente ideal en una lista de contactos reales y validados.

*   **Características Clave:**
    *   **Asistente Wizard:** Una entrevista conversacional donde el usuario describe a quién quiere venderle. La IA procesa esta información y genera 3 "playbooks" (estrategias de búsqueda) detallados.
    *   **Bóveda de Estrategias:** Guarda las fórmulas de búsqueda exitosas para reutilizarlas con un solo clic.
    *   **Buscador IA:** Ejecuta la estrategia seleccionada, utilizando un modelo de IA (Gemini, Llama 3) para rastrear la web y generar una lista de prospectos que coincidan con el perfil.
    *   **Auditor de Calidad:** El sistema valida automáticamente los datos encontrados (teléfonos, emails) para descartar información falsa o de baja calidad.
    *   **Entrenamiento de Modelos (Mejorador de Prompt):** El corazón del sistema. Permite al usuario editar y guardar la instrucción principal (el "prompt") que la IA utiliza para buscar. Al mejorar este prompt, los resultados de la prospección se vuelven cada vez más precisos.