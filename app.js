// =============================================================================
// GRIST "INTRA-FORM" CUSTOM WIDGET - Vue.js Version
// A configurable form that supports drag & drop ordering,
// conditional fields, rich text editing, and field validation.
// =============================================================================

const { createApp, ref, computed, reactive, onMounted, toRaw } = Vue;

// DOMPurify configuration for XSS protection (shared across all sanitization calls)
const sanitizeConfig = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'li', 'h1', 'h2', 'h3', 'p', 'br', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'style'],
  ALLOW_DATA_ATTR: false
};

// Store reference to Vue app instance for grist.ready() callback
let vueApp = null;

// Initialize Grist widget immediately (before Vue app creation)
// This must be called at the top level for Grist to properly track widget options
grist.ready({
  requiredAccess: 'full',
  onEditOptions: () => {
    if (vueApp) {
      vueApp.showConfigModal = true;
    }
  }
});

const app = createApp({
  setup() {
    // -------------------------------------------------------------------------
    // STATE
    // -------------------------------------------------------------------------
    const columns = ref([]);              // List of column IDs from current table
    const columnMetadata = ref({});       // Metadata for each column (type, choices, etc.)
    const formElements = ref([]);         // Form configuration (fields, separators, text)
    const formData = reactive({});        // Current form values
    const errors = reactive({});          // Validation errors per field
    const pendingAttachments = reactive({}); // Temporary storage for file uploads per column
    const refSearch = reactive({});       // Per-field combobox UI state for Ref/RefList search

    // -------------------------------------------------------------------------
    // ATTACHMENT HANDLING
    // -------------------------------------------------------------------------

    // Format file size in human-readable format (bytes, Ko, Mo)
    function formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' o';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
      return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
    }

    // Trigger attachment modal input click
    function triggerFileInput(col) {
      document.getElementById('file_' + col)?.click();
    }

    // Handle file selection
    function onFileSelect(col, event) {
      const files = Array.from(event.target.files);
      const maxSize = 10 * 1024 * 1024; // 10 MB
      const maxFiles = 3;

      if (!pendingAttachments[col]) {
        pendingAttachments[col] = [];
      }

      files.forEach(file => {
        if (pendingAttachments[col].length >= maxFiles) {
          errors[col] = `Maximum ${maxFiles} pièces jointes par champ`;
          return;
        }

        if (file.size > maxSize) {
          errors[col] = `Le fichier "${file.name}" dépasse 10 Mo`;
          return;
        }

        // Prevent duplicates
        if (pendingAttachments[col].some(f => f.name === file.name && f.size === file.size)) {
          return;
        }

        pendingAttachments[col].push(file);
      });

      // Reset input to allow re-selecting same file
      event.target.value = '';
    }

    // Remove attachment from list
    function removeAttachment(col, index) {
      pendingAttachments[col].splice(index, 1);
    }

    // Upload pending attachments to Grist and return attachment IDs in list format
    async function uploadAttachments(col) {
      const files = pendingAttachments[col] || [];
      if (files.length === 0) return null;

      const attachmentIds = [];
      const tokenInfo = await grist.docApi.getAccessToken({ readOnly: false });

      for (const file of files) {
        const formData = new FormData();
        formData.append('upload', file, file.name);

        const response = await fetch(`${tokenInfo.baseUrl}/attachments?auth=${tokenInfo.token}`, {
          method: 'POST',
          body: formData,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (!response.ok) {
          throw new Error(`Le téléchargement a échoué : ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        attachmentIds.push(result[0]);
      }

      // Return in Grist list format: ['L', id1, id2, ...]
      return ['L', ...attachmentIds];
    }

    // UI state
    const showConfigModal = ref(false);   // Whether config modal is visible
    const showOverlay = ref(false);       // Whether popup (used to edit
                                          // a label or set a condition)
                                          // overlay is visible
    const globalFont = ref('');           // Selected font family
    const globalPadding = ref('');        // Selected padding size

    // Messages
    const formErrorMessage = ref('');     // Global form error message
    const formSuccessMessage = ref('');   // Success message after submission

    // Add element panel state
    const newElementType = ref('');       // Selected type for new element
    const selectedColumn = ref('');       // Selected column for new field
    const newElementContent = ref('');    // Content for new text element

    // Drag & drop state
    const draggedIndex = ref(null);       // Index of currently dragged element
    const dragOverIndex = ref(null);      // Index of element being dragged over
    const dragPosition = ref('');         // 'top' or 'bottom' drop position

    // "Edit popup" (used to edit text) state
    const editPopup = reactive({
      show: false,
      title: '',
      value: '',
      index: null,
      property: ''
    });

    // "Filter popup" (used for conditional) state
    const filterPopup = reactive({
      show: false,
      index: null,
      field: '',
      operator: 'equals',
      value: '',
      values: [],
      hasExisting: false
    });

    // "Validation popup" (used for maxLength) state
    const validationPopup = reactive({
      show: false,
      index: null,
      maxLength: '',
      hasExisting: false
    });

    // Rich editor state
    const richEditor = ref(null);
    const colorPicker = reactive({ show: false, type: '' });
    const emojiPicker = reactive({ show: false });
    const activeFormats = reactive({ bold: false, italic: false, underline: false });

    // Editor colors palette
    const editorColors = [
      '#000000', '#434343', '#666666', '#999999', '#CCCCCC',
      '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
      '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#F43F5E'
    ];

    // Emoji list
    const emojis = ['😀', '😊', '👍', '❤️', '⭐', '🎉', '✅', '❌', '⚠️', '💡', '📌', '🔥', '💪', '🙏', '👏', '🤝'];


    // -------------------------------------------------------------------------
    // COMPUTED PROPERTIES
    // -------------------------------------------------------------------------

    // Apply global font and padding styles to form container
    // TODO: em instead of px
    const containerStyle = computed(() => {
      let paddingX = '24px';
      switch (globalPadding.value) {
        case 'small': paddingX = '12px'; break;
        case 'medium': paddingX = '40px'; break;
        case 'large': paddingX = '64px'; break;
      }

      return {
        fontFamily: globalFont.value || 'inherit',
        paddingLeft: paddingX,
        paddingRight: paddingX
      };
    });

    // Update column dropdown to show only unused, non-formula columns
    // Called when opening the config modal or after adding/removing a field
    const availableColumns = computed(() => {
      // Get set of columns already used in the form (O(1) lookup)
      const usedColumns = new Set(
          formElements.value
              .filter(el => el.type === 'field')
              .map(el => el.fieldName)
      );

      // Filter out already used columns and formula columns (which can't be edited)
      return columns.value.filter(col => {
        if (usedColumns.has(col)) return false;
        const meta = columnMetadata.value[col];
        if (meta?.isFormula) return false;
        return true;
      });
    });

    // Get fields that can be used as conditions (single Choice or Ref)
    const eligibleFieldsForConditions = computed(() => {
      return formElements.value.filter(el => {
        if (el.type !== 'field') return false;
        const meta = columnMetadata.value[el.fieldName];
        if (!meta) return false;
        return (meta.choices?.length > 0 && !meta.isMultiple) ||
          (meta.isRef && !meta.isMultiple && meta.refChoices?.length > 0);
      });
    });

    // -------------------------------------------------------------------------
    // GRIST INITIALIZATION
    // -------------------------------------------------------------------------

    onMounted(async () => {
      // Fetch table structure then load saved config
      columnMetadata.value = await getColumnMetadata();
      columns.value = Object.keys(columnMetadata.value);

      // Load form configuration from Grist widget options
      await loadConfiguration();

      // Re-render when value added to ref column (to update ref choices)
      grist.onRecords(() => {
        getColumnMetadata().then(meta => {
          columnMetadata.value = meta;
        });
      });
    });

    // -------------------------------------------------------------------------
    // COLUMN & METADATA FETCHING
    // -------------------------------------------------------------------------

    // Fetch detailed metadata for all columns (type, choices, refs, etc.)
    // Returns: { colId: { type, choices, isRef, refChoices, isBool, ... }, ... }
    async function getColumnMetadata() {
      try {
        // Get current table name (eg "Table1")
        const table = grist.getTable();
        const currentTableId = await table.getTableId();

        // _grist_Tables_column: list of all columns across all tables
        // eg   {
        //     id: [1, 2, 3, 4, 5, 6, 7],
        //     colId: ['Nom', 'Email', 'Date', 'Montant', 'Titre', 'Prix', 'Stock'],
        //     parentId: [1, 1, 2, 2, 3, 3, 3]
        //   }
        const colsInfo = await grist.docApi.fetchTable('_grist_Tables_column');

        // _grist_Tables: list of all tables in the document
        // eg   {
        //     id: [1, 2, 3],  // numeric ref
        //     tableId: ['Clients', 'Commandes', 'Produits']
        //   }
        const tablesInfo = await grist.docApi.fetchTable('_grist_Tables');

        const metadata = {};

        // Convert tableId to numeric ref (eg "Clients" → 1)
        const currentTableNumericId = tablesInfo.id[tablesInfo.tableId.indexOf(currentTableId)];

        // Used for visibleCol: numeric column ID -> column info
        // Example: visibleCol=5 means "display column with id=5" for Ref fields
        const colById = {};
        for (let i = 0; i < colsInfo.id.length; i++) {
          colById[colsInfo.id[i]] = {
            colId: colsInfo.colId[i],
            parentId: colsInfo.parentId[i]
          };
        }

        // -----------------------------------------------------------------------
        // LOOP THROUGH COLUMNS BELONGING TO CURRENT TABLE
        // -----------------------------------------------------------------------
        for (let i = 0; i < colsInfo.colId.length; i++) {
          if (colsInfo.parentId[i] !== currentTableNumericId) continue;

          const colId = colsInfo.colId[i];

          // Exclude system columns (id, manualSort, gristHelper_*)
          if (colId === 'id' || colId === 'manualSort' || colId.startsWith('gristHelper')) continue;

          const type = colsInfo.type[i];  // eg: "Text", "Int", "Ref:Clients", "ChoiceList"
          let choices = null;
          let refTable = null;
          let refChoices = [];

          // For Choice/ChoiceList columns: extract choices from widgetOptions JSON
          // Example: {"choices": ["Option A", "Option B", "Option C"]}
          // Note: Check type first because Grist keeps widgetOptions after column type conversion
          if ((type === 'Choice' || type === 'ChoiceList') && colsInfo.widgetOptions?.[i]) {
            try {
              const options = JSON.parse(colsInfo.widgetOptions[i]);
              if (options.choices) choices = options.choices;
            } catch (e) { }
          }

          // For Ref/RefList columns: extract target table name from type
          // "Ref:Clients" -> refTable = "Clients"
          // "RefList:Products" -> refTable = "Products"
          if (type.startsWith('Ref:')) {
            refTable = type.substring(4);
          } else if (type.startsWith('RefList:')) {
            refTable = type.substring(8);
          }

          // For Ref/RefList: fetch target table and build dropdown choices
          if (refTable) {
            try {
              const refData = await grist.docApi.fetchTable(refTable);

              // visibleCol: for Reference columns: numeric ID of the display column
              let displayColId = null;
              const visibleColRef = colsInfo.visibleCol?.[i];

              // Resolve numeric ID -> column name using our index
              if (visibleColRef && visibleColRef !== 0 && colById[visibleColRef]) {
                displayColId = colById[visibleColRef].colId;
              }

              // Fallback: use first non-system column if visibleCol not set
              if (!displayColId || !refData[displayColId]) {
                displayColId = Object.keys(refData).find(k => k !== 'id' && k !== 'manualSort');
              }

              // Build choices array: [{id: 1, label: "Client A"}, {id: 2, label: "Client B"}]
              refChoices = refData.id.map((id, idx) => ({
                id,
                label: displayColId && refData[displayColId] ? refData[displayColId][idx] : id
              }));
            } catch (e) { }
          }

          // Store all metadata for this column
          metadata[colId] = {
            type,
            choices,                    // For Choice/ChoiceList: ["A", "B", "C"]
            label: colsInfo.label?.[i] || colId,
            isMultiple: type === 'ChoiceList' || type.startsWith('RefList:'),
            isRef: type.startsWith('Ref:') || type.startsWith('RefList:'),
            refTable,                   // Target table name for Ref/RefList
            refChoices,                 // [{id, label}] for Ref/RefList dropdowns
            isBool: type === 'Bool',
            isDate: type === 'Date',
            isDateTime: type.startsWith('DateTime:'),
            isNumeric: type === 'Numeric',
            isInt: type === 'Int',
            isFormula: colsInfo.isFormula?.[i] === true && colsInfo.formula?.[i]?.length > 0,
            isAttachment: type === 'Attachments'
          };
        }

        return metadata;
      } catch (error) {
        console.error('Erreur metadata:', error);
        return {};
      }
    }

    // -------------------------------------------------------------------------
    // CONFIGURATION PERSISTENCE
    // -------------------------------------------------------------------------

    // Load form configuration from Grist widget options
    async function loadConfiguration() {
      const options = await grist.getOptions() || {};
      const isFirstInstall = !options.initialized && !options.formElements;

      if (isFirstInstall) {
        // Auto-initialize with all editable (non-formula) columns
        const editableColumns = columns.value.filter(col => {
          const meta = columnMetadata.value[col];
          return !meta?.isFormula;
        });

        formElements.value = editableColumns.map(col => ({
          type: 'field',
          fieldName: col,
          fieldLabel: columnMetadata.value[col]?.label || col,
          required: false,
          maxLength: null,
          conditional: null
        }));
        
       // TODO : make it reactive instead
        await grist.setOptions({ initialized: true, formElements: toRaw(formElements.value) });
      } else {
        // Load existing configuration and sanitize HTML content for XSS protection
        formElements.value = (options.formElements || []).map(el => {
          if (el.type === 'text' && el.content) {
            el.content = DOMPurify.sanitize(el.content, sanitizeConfig);
          }
          if (el.type === 'field' && el.fieldLabel) {
            el.fieldLabel = DOMPurify.sanitize(el.fieldLabel, sanitizeConfig);
          }

          // Clean up invalid properties based on current column type
          if (el.type === 'field') {
            const meta = columnMetadata.value[el.fieldName];

            // multiline: only valid for pure text fields
            if (el.multiline && meta && !isPureTextFieldByMeta(meta)) {
              delete el.multiline;
            }

            // maxLength: only valid for text/numeric/int fields
            if (el.maxLength != null && meta && !isTextOrNumericFieldByMeta(meta)) {
              delete el.maxLength;
            }

            // conditional: verify that the referenced field is still a valid condition field
            if (el.conditional) {
              const condMeta = columnMetadata.value[el.conditional.field];
              const isValidConditionField = condMeta && (
                (condMeta.choices?.length > 0 && !condMeta.isMultiple) ||
                (condMeta.isRef && !condMeta.isMultiple && condMeta.refChoices?.length > 0)
              );
              if (!isValidConditionField) {
                delete el.conditional;
              }
            }
          }

          return el;
        });
      }

      // Load global style settings
      globalFont.value = options.globalFont || '';
      globalPadding.value = options.globalPadding || '';

      // Initialize formData with default values for each field
      formElements.value.forEach(el => {
        if (el.type === 'field') {
          const meta = columnMetadata.value[el.fieldName];
          formData[el.fieldName] = defaultValue(meta);
        }
      });
    }

    function defaultValue(meta) {
      if (meta?.isBool) {
        return false;
      } else if (meta?.isMultiple) {
        return [];
      } else {
        return '';
      }
    }

    // Save form configuration to Grist widget options
    // Note: We use toRaw to convert Vue Proxy objects to plain JS objects
    // because Grist's setOptions() uses postMessage which cannot clone Proxy objects
    // TODO : make it reactive instead
    async function saveConfiguration() {
      await grist.setOptions({
        initialized: true,
        formElements: toRaw(formElements.value),
        globalFont: globalFont.value,
        globalPadding: globalPadding.value
      });
    }

    // -------------------------------------------------------------------------
    // ELEMENT MANAGEMENT
    // -------------------------------------------------------------------------

    // Add new element to form configuration
    // Handles column fields, separators, and text blocks
    async function addElement() {
      const type = newElementType.value;
      if (!type) return;

      if (type === 'column') {
        const col = selectedColumn.value;
        if (!col) {
          alert('Veuillez sélectionner une colonne');
          return;
        }
        // Add field element linked to this column
        const meta = columnMetadata.value[col];
        formElements.value.push({
          type: 'field',
          fieldName: col,
          fieldLabel: meta?.label || col,
          required: false,
          maxLength: null,
          conditional: null
        });
        // Initialize form data for this field
        formData[col] = defaultValue(meta);
      } else if (type === 'separator') {
        // Add horizontal separator
        formElements.value.push({ type: 'separator', content: '' });
      } else if (type === 'text') {
        // Add text block (allow empty content, user can edit later)
        const content = newElementContent.value.trim();
        formElements.value.push({ type: 'text', content: content || '' });
      }

      await saveConfiguration();

      // Reset the "Add element" panel
      newElementType.value = '';
      selectedColumn.value = '';
      newElementContent.value = '';
    }

    // Remove element from form configuration
    // Column becomes available again after removal
    async function removeElement(index) {
      formElements.value.splice(index, 1);
      await saveConfiguration();
    }

    // Toggle "required status" for a field
    async function toggleRequired(index) {
      formElements.value[index].required = !formElements.value[index].required;
      await saveConfiguration();
    }

    // -------------------------------------------------------------------------
    // DRAG & DROP REORDERING
    // -------------------------------------------------------------------------

    // Called when drag starts on an element
    function onDragStart(index, event) {
      draggedIndex.value = index;
      event.dataTransfer.effectAllowed = 'move';
    }

    // Called when drag ends (cleanup)
    function onDragEnd() {
      draggedIndex.value = null;
      dragOverIndex.value = null;
      dragPosition.value = '';
    }

    // Called when dragging over another element
    // Calculates whether to show drop indicator at top or bottom
    function onDragOver(index, event) {
      if (draggedIndex.value === null || draggedIndex.value === index) return;

      dragOverIndex.value = index;

      // Show drop indicator based on mouse position
      const rect = event.currentTarget.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      dragPosition.value = event.clientY < midpoint ? 'top' : 'bottom';
    }

    // Called when element is dropped
    // Reorders formElements array and saves configuration
    async function onDrop(index) {
      if (draggedIndex.value === null || draggedIndex.value === index) return;

      const fromIndex = draggedIndex.value;
      let toIndex = dragPosition.value === 'top' ? index : index + 1;

      // Adjust for removal of dragged element
      if (fromIndex < toIndex) toIndex--;

      // Move element in array
      const element = formElements.value.splice(fromIndex, 1)[0];
      formElements.value.splice(toIndex, 0, element);

      await saveConfiguration();
      onDragEnd();
    }

    // -------------------------------------------------------------------------
    // POPUP MANAGEMENT
    // -------------------------------------------------------------------------

    // Close all popups and overlay
    function closeAllPopups() {
      showOverlay.value = false;
      editPopup.show = false;
      filterPopup.show = false;
      validationPopup.show = false;
    }

    // Show edit popup for field label
    function editLabel(index) {
      const el = formElements.value[index];
      editPopup.title = 'Modifier le libellé';
      editPopup.value = el.fieldLabel || el.fieldName;
      editPopup.index = index;
      editPopup.property = 'fieldLabel';
      editPopup.show = true;
      showOverlay.value = true;
    }

    // Show edit popup for text content
    function editContent(index) {
      const el = formElements.value[index];
      editPopup.title = 'Modifier le contenu';
      editPopup.value = el.content || '';
      editPopup.index = index;
      editPopup.property = 'content';
      editPopup.show = true;
      showOverlay.value = true;
    }

    // Save edit popup changes (kept for compatibility)
    async function saveEdit() {
      if (editPopup.value.trim()) {
        formElements.value[editPopup.index][editPopup.property] = editPopup.value;
        await saveConfiguration();
      }
      editPopup.show = false;
      showOverlay.value = false;
    }

    // -------------------------------------------------------------------------
    // RICH TEXT EDITOR
    // -------------------------------------------------------------------------

    // Update active format states based on current selection
    // The queryCommandState() is officially obsolete/deprecated but there's no alternative...(see execCommand) 
    function updateActiveFormats() {
      activeFormats.bold = document.queryCommandState('bold');
      activeFormats.italic = document.queryCommandState('italic');
      activeFormats.underline = document.queryCommandState('underline');
    }

    // Execute a formatting command on the editor
    // The execCommand() is officially obsolete/deprecated but there's no alternative...
    function execCmd(command) {
      document.execCommand(command, false, null);
      updateActiveFormats();
      richEditor.value?.focus();
    }

    // Apply a format block (h1, h2, h3, p)
    function applyFormat(event) {
      const value = event.target.value;
      if (value) {
        document.execCommand('formatBlock', false, value);
        event.target.value = '';
        richEditor.value?.focus();
      }
    }

    // Insert a link at cursor position
    function insertLink() {
      const url = prompt('URL du lien :');
      if (url) {
        const selection = window.getSelection();
        const text = selection.toString() || url;
        const normalizedUrl = url.match(/^https?:\/\//) ? url : 'https://' + url;
        document.execCommand('insertHTML', false, `<a href="${normalizedUrl}" target="_blank">${text}</a>`);
      }
      richEditor.value?.focus();
    }

    // Toggle emoji picker visibility
    function toggleEmojiPicker() {
      emojiPicker.show = !emojiPicker.show;
      colorPicker.show = false;
    }

    // Insert emoji at cursor position
    function insertEmoji(emoji) {
      document.execCommand('insertText', false, emoji);
      emojiPicker.show = false;
      richEditor.value?.focus();
    }

    // Toggle color picker visibility
    function toggleColorPicker(type) {
      if (colorPicker.show && colorPicker.type === type) {
        colorPicker.show = false;
      } else {
        colorPicker.show = true;
        colorPicker.type = type;
      }
      emojiPicker.show = false;
    }

    // Apply color to text or background
    // For background colors, convert to rgba with 0.2 opacity for transparency
    function applyColor(command, color) {
      let finalColor = color;
      if (command === 'backColor') {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        finalColor = `rgba(${r},${g},${b},0.2)`;
      }
      document.execCommand(command, false, finalColor);
      colorPicker.show = false;
      richEditor.value?.focus();
    }

    // Remove color (reset to default)
    function removeColor(command) {
      if (command === 'foreColor') {
        document.execCommand('foreColor', false, '#000000');
      } else {
        // Using white background because 'transparent' doesn't work with partial selections
        // TODO: if adding dark mode, use the editor background color
        document.execCommand('backColor', false, '#FFFFFF');
      }
      colorPicker.show = false;
      richEditor.value?.focus();
    }

    // Handle keyboard shortcuts in editor
    function onEditorKeydown(event) {
      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case 'b':
            event.preventDefault();
            document.execCommand('bold');
            updateActiveFormats();
            break;
          case 'i':
            event.preventDefault();
            document.execCommand('italic');
            updateActiveFormats();
            break;
          case 'u':
            event.preventDefault();
            document.execCommand('underline');
            updateActiveFormats();
            break;
        }
      }
    }

    // Update formats on selection change
    function onEditorSelect() {
      updateActiveFormats();
    }

    // Close pickers when clicking outside of them
    function closePickersOnClickOutside(event) {
      if (!event.target.closest('.color-picker-wrapper') && !event.target.closest('.emoji-picker')) {
        colorPicker.show = false;
        emojiPicker.show = false;
      }
    }

    // Close edit popup
    function closeEditPopup() {
      editPopup.show = false;
      showOverlay.value = false;
      colorPicker.show = false;
      emojiPicker.show = false;
    }

    // Save rich editor content
    async function saveRichEdit() {
      const rawContent = richEditor.value?.innerHTML?.trim();
      if (rawContent && rawContent !== '<br>') {
        // Sanitize HTML to prevent XSS attacks
        const content = DOMPurify.sanitize(rawContent, sanitizeConfig);
        formElements.value[editPopup.index][editPopup.property] = content;
        await saveConfiguration();
      }
      closeEditPopup();
    }

    // -------------------------------------------------------------------------
    // CONDITIONAL DISPLAY POPUP
    // -------------------------------------------------------------------------

    // Show popup to configure conditional display rules for a field
    function showFilterPopup(index) {
      const el = formElements.value[index];
      filterPopup.index = index;

      // Check if this field already has a conditional rule configured
      filterPopup.hasExisting = !!el.conditional;

      // Pre-fill if already configured
      if (el.conditional) {
        filterPopup.field = el.conditional.field;
        filterPopup.operator = el.conditional.operator || 'equals';
        filterPopup.value = el.conditional.value;
        updateFilterValues();
      } else {
        filterPopup.field = '';
        filterPopup.operator = 'equals';
        filterPopup.value = '';
        filterPopup.values = [];
      }

      filterPopup.show = true;
      showOverlay.value = true;
    }

    // Populate value dropdown based on selected conditional field
    // Shows either reference choices (for Ref columns) or choice options (for Choice columns)
    function updateFilterValues() {
      // Reset to empty if no field selected
      if (!filterPopup.field) {
        filterPopup.values = [];
        return;
      }

      const meta = columnMetadata.value[filterPopup.field];
      if (!meta) {
        filterPopup.values = [];
        return;
      }

      // For Ref columns: use refChoices (id + label from referenced table)
      if (meta.refChoices?.length > 0) {
        filterPopup.values = meta.refChoices;
      // For Choice columns: use choices array directly
      } else if (meta.choices?.length > 0) {
        filterPopup.values = meta.choices.map(c => ({ id: c, label: c }));
      } else {
        filterPopup.values = [];
      }
    }

    // Save the conditional rule configuration
    async function saveFilter() {
      // Only save if both field and value are selected, otherwise clear the rule
      if (filterPopup.field && filterPopup.value) {
        formElements.value[filterPopup.index].conditional = {
          field: filterPopup.field,
          operator: filterPopup.operator,
          value: filterPopup.value
        };
      } else {
        formElements.value[filterPopup.index].conditional = null;
      }
      await saveConfiguration();
      filterPopup.show = false;
      showOverlay.value = false;
    }

    // Remove the conditional rule from this field
    async function deleteFilter() {
      formElements.value[filterPopup.index].conditional = null;
      await saveConfiguration();
      filterPopup.show = false;
      showOverlay.value = false;
    }

    // -------------------------------------------------------------------------
    // FIELD TYPE HELPERS
    // -------------------------------------------------------------------------

    // Check if metadata indicates a text or numeric field (can have maxLength validation)
    function isTextOrNumericFieldByMeta(meta) {
      if (!meta) return false;
      return !meta.isBool && !meta.isDate && !meta.isDateTime && !meta.isMultiple && !meta.isAttachment &&
        (!meta.choices || meta.choices.length === 0) &&
        (!meta.isRef || meta.refChoices.length === 0);
    }

    // Check if metadata indicates a pure text field (can be multiline)
    function isPureTextFieldByMeta(meta) {
      if (!isTextOrNumericFieldByMeta(meta)) return false;
      return !meta.isNumeric && !meta.isInt;
    }

    // Check if a field is text or numeric (can have maxLength validation)
    function isTextOrNumericField(element) {
      if (element.type !== 'field') return false;
      return isTextOrNumericFieldByMeta(columnMetadata.value[element.fieldName]);
    }

    // Check if a field is pure text (can be multiline)
    function isPureTextField(element) {
      if (element.type !== 'field') return false;
      return isPureTextFieldByMeta(columnMetadata.value[element.fieldName]);
    }

    // -------------------------------------------------------------------------
    // VALIDATION POPUP (maxLength)
    // -------------------------------------------------------------------------

    // Show popup to configure maxLength validation
    function showValidationPopup(index) {
      const el = formElements.value[index];
      validationPopup.index = index;
      validationPopup.hasExisting = el.maxLength !== null && el.maxLength !== undefined;
      validationPopup.maxLength = el.maxLength || '';
      validationPopup.show = true;
      showOverlay.value = true;
    }

    // Save maxLength validation
    async function saveValidation() {
      const maxLength = validationPopup.maxLength;
      formElements.value[validationPopup.index].maxLength = maxLength ? parseInt(maxLength) : null;
      await saveConfiguration();
      validationPopup.show = false;
      showOverlay.value = false;
    }

    // Remove maxLength validation
    async function deleteValidation() {
      formElements.value[validationPopup.index].maxLength = null;
      await saveConfiguration();
      validationPopup.show = false;
      showOverlay.value = false;
    }

    // -------------------------------------------------------------------------
    // MULTILINE TOGGLE
    // -------------------------------------------------------------------------

    // Toggle multiline for a text field (displays textarea instead of input)
    async function toggleMultiline(index) {
      formElements.value[index].multiline = !formElements.value[index].multiline;
      await saveConfiguration();
    }

    // -------------------------------------------------------------------------
    // CONDITIONAL FIELD DISPLAY (only available for column types Choice and Ref)
    // -------------------------------------------------------------------------

    // Determines if a field should be visible based on its conditional rule
    // A conditional rule is: "show this field if [otherField] [equals/notEquals] [value]"
    // Returns true if: no condition set, or condition is satisfied
    function shouldShowField(element) {
      if (!element.conditional) return true;

      const conditionalField = element.conditional.field;    // Field we depend on (eg "Status")
      const conditionalValue = element.conditional.value;    // Expected value (eg "Active" or ref ID)
      const conditionalOperator = element.conditional.operator; // "equals" or "notEquals"

      // Get the current value of the field we depend on
      const currentValue = formData[conditionalField];
      const meta = columnMetadata.value[conditionalField];
      if (!meta) return true;

      // For Ref columns: compare numeric IDs (not display labels)
      let expectedValue = conditionalValue;
      let compareValue = currentValue;

      if (meta.isRef) {
        expectedValue = parseInt(conditionalValue);
        compareValue = currentValue ? parseInt(currentValue) : null;
      }

      // Evaluate the condition
      if (conditionalOperator === 'notEquals') {
        return compareValue !== expectedValue;
      }
      return compareValue === expectedValue;
    }

    // -------------------------------------------------------------------------
    // FORM INPUT HELPERS
    // -------------------------------------------------------------------------

    // Generate label HTML with required star if needed
    function getLabelHtml(element) {
      let html = element.fieldLabel || element.fieldName;
      if (element.required) {
        html += ' <span class="required-star">*</span>';
      }
      return html;
    }


    // Check if a field should display a select dropdown (Choice or Ref)
    function hasSelectOptions(element) {
      const meta = columnMetadata.value[element.fieldName];
      if (!meta) return false;
      return (meta.choices?.length > 0) || (meta.isRef && meta.refChoices?.length > 0);
    }

    // Get options for select dropdown
    // Returns: [{id, label}, ...] for Choice, ChoiceList, Ref, RefList columns
    function getSelectOptions(element) {
      const meta = columnMetadata.value[element.fieldName];
      if (!meta) return [];

      // For Ref/RefList columns: use refChoices (id + label from referenced table)
      if (meta.refChoices?.length > 0) {
        return meta.refChoices;
      }

      // For Choice/ChoiceList columns: map choices to {id, label} format
      if (meta.choices?.length > 0) {
        return meta.choices.map(c => ({ id: c, label: c }));
      }

      return [];
    }

    // -------------------------------------------------------------------------
    // REFERENCE SEARCH (searchable combobox for Ref / RefList fields)
    // -------------------------------------------------------------------------

    // Lazily create and return the per-field combobox UI state
    function refState(col) {
      if (!refSearch[col]) {
        refSearch[col] = { open: false, query: '' };
      }
      return refSearch[col];
    }

    // Normalize a string for search: lowercase + strip diacritics (é -> e),
    // so a query without accents still matches accented labels.
    function normalizeText(s) {
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    }

    // Levenshtein edit distance between two strings (iterative, two rolling rows)
    function levenshtein(a, b) {
      if (a === b) return 0;
      if (!a.length) return b.length;
      if (!b.length) return a.length;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      let curr = new Array(b.length + 1);
      for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
      }
      return prev[b.length];
    }

    // Fuzzy match score of a query against a label (lower = better, null = no match).
    // Tiers: exact substring first (prefix ranks highest), then a typo-tolerant
    // fallback using bounded Levenshtein over a sliding window and each word.
    function fuzzyScore(query, label) {
      const q = normalizeText(query);
      const t = normalizeText(label);
      if (!q) return 0;

      const tokens = q.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        let searchFrom = 0;
        let start = null;
        let end = null;
        for (let ti = 0; ti < tokens.length; ti++) {
          const token = tokens[ti];
          if (ti > 0) {
            while (searchFrom < t.length && t[searchFrom] === ' ') searchFrom++;
          }
          const idx = t.indexOf(token, ti === 0 ? 0 : searchFrom);
          if (idx === -1) break;
          if (ti > 0) {
            const gap = t.slice(end + 1, idx);
            if (gap.length > 0 && !/^\s+$/.test(gap)) { start = null; break; }
          }
          if (start === null) start = idx;
          end = idx + token.length - 1;
          searchFrom = end + 1;
          if (ti === tokens.length - 1) return start;
        }
      }

      const idx = t.indexOf(q);
      if (idx !== -1) return idx;            // substring: prefix (idx 0) first

      const collapsedQ = q.replace(/\s+/g, '');
      if (collapsedQ) {
        const collapsed = findCollapsedRange(t, collapsedQ);
        if (collapsed) return collapsed.start;
      }

      // Allow roughly one typo every three characters (at least one)
      const maxErrors = Math.max(1, Math.floor(q.length / 3));
      let best = Infinity;

      // Slide a window of about the query length across the label
      for (let i = 0; i + q.length - 1 < t.length; i++) {
        best = Math.min(best, levenshtein(q, t.substr(i, q.length)));
        best = Math.min(best, levenshtein(q, t.substr(i, q.length + 1)));
        if (best === 0) break;
      }
      // Also compare against individual words (handles short labels / word typos)
      for (const word of t.split(/\s+/)) {
        best = Math.min(best, levenshtein(q, word));
      }

      // Offset keeps fuzzy matches ranked after any substring match
      return best <= maxErrors ? 1000 + best : null;
    }

    // Options of a Ref/RefList field: all options stay available, only reordered
    // by resemblance to the current query (best match first, non-matches last).
    // Array.sort is stable, so ties and non-matches keep their original order.
    function filteredRefOptions(element) {
      const opts = getSelectOptions(element);
      const q = (refSearch[element.fieldName]?.query || '').trim();
      if (!q) return opts;
      return opts
        .map(opt => ({ opt, score: fuzzyScore(q, opt.label) }))
        .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))
        .map(entry => entry.opt);
    }

    // Map each normalized character back to its starting index in the original label
    function buildNormMap(label) {
      let normalized = '';
      const normToOrig = [];
      for (let i = 0; i < label.length; ) {
        const cp = label.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        const n = normalizeText(ch);
        for (let j = 0; j < n.length; j++) {
          normalized += n[j];
          normToOrig.push(i);
        }
        i += ch.length;
      }
      return { normalized, normToOrig };
    }

    // Build a space-stripped copy of the normalized label, with a map back to
    // normalized indices (used when the query omits spaces between words).
    function buildCollapsedMap(normalized) {
      let collapsed = '';
      const collapsedToNorm = [];
      for (let i = 0; i < normalized.length; i++) {
        if (normalized[i] === ' ') continue;
        collapsed += normalized[i];
        collapsedToNorm.push(i);
      }
      return { collapsed, collapsedToNorm };
    }

    function findCollapsedRange(normalized, collapsedQuery) {
      if (!collapsedQuery) return null;
      const { collapsed, collapsedToNorm } = buildCollapsedMap(normalized);
      const idx = collapsed.indexOf(collapsedQuery);
      if (idx === -1) return null;
      return {
        start: collapsedToNorm[idx],
        end: collapsedToNorm[idx + collapsedQuery.length - 1]
      };
    }

    // Find the normalized character range to highlight. Multi-word queries match
    // each token in order; only whitespace may appear between tokens, so spaces
    // never split the highlight into separate spans. Queries without spaces also
    // match across whitespace in the label (e.g. "lesavan" → "Les avan").
    function findHighlightRange(label, rawQuery) {
      const tokens = normalizeText(rawQuery).split(/\s+/).filter(Boolean);
      if (!tokens.length) return null;

      const { normalized, normToOrig } = buildNormMap(label);

      if (tokens.length === 1) {
        const token = tokens[0];
        const idx = normalized.indexOf(token);
        if (idx !== -1) {
          return { start: idx, end: idx + token.length - 1, normToOrig };
        }
        const collapsed = findCollapsedRange(normalized, token);
        if (collapsed) return { ...collapsed, normToOrig };
        return null;
      }

      let searchFrom = 0;
      let start = null;
      let end = null;

      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t];
        if (t > 0) {
          while (searchFrom < normalized.length && normalized[searchFrom] === ' ') searchFrom++;
        }
        const idx = normalized.indexOf(token, t === 0 ? 0 : searchFrom);
        if (idx === -1) return null;

        if (t > 0) {
          const gap = normalized.slice(end + 1, idx);
          if (gap.length > 0 && !/^\s+$/.test(gap)) return null;
        }

        if (start === null) start = idx;
        end = idx + token.length - 1;
        searchFrom = end + 1;
      }

      return { start, end, normToOrig };
    }

    // Build the option label as HTML with the matching query highlighted as one
    // contiguous block (including whitespace between matched words).
    function highlightRefLabel(element, opt) {
      const label = String(opt.label);
      const escapeHtml = str =>
        str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const raw = (refSearch[element.fieldName]?.query || '').trim();
      if (!raw || fuzzyScore(raw, label) === null) return escapeHtml(label);

      const range = findHighlightRange(label, raw);
      if (!range) return escapeHtml(label);

      const highlightOrig = new Set();
      for (let k = range.start; k <= range.end; k++) {
        highlightOrig.add(range.normToOrig[k]);
      }

      let html = '';
      let open = false;
      for (let i = 0; i < label.length; ) {
        const cp = label.codePointAt(i);
        const ch = String.fromCodePoint(cp);
        const inHighlight = highlightOrig.has(i);
        if (inHighlight && !open) {
          html += '<span class="ref-match">';
          open = true;
        } else if (!inHighlight && open) {
          html += '</span>';
          open = false;
        }
        html += escapeHtml(ch);
        i += ch.length;
      }
      if (open) html += '</span>';
      return html;
    }

    // Open the dropdown and start from an empty query so all options show
    function openRefSearch(element) {
      const state = refState(element.fieldName);
      state.query = '';
      state.open = true;
    }

    // Update the query as the user types
    function onRefSearchInput(element, event) {
      const state = refState(element.fieldName);
      state.query = event.target.value;
      state.open = true;
    }

    // Close the dropdown (option clicks use mousedown.prevent so blur fires only
    // when focus truly leaves the field)
    function closeRefSearch(element) {
      refState(element.fieldName).open = false;
    }

    // Non-mutating reads for the template (state is created lazily by the event
    // handlers above, never during render)
    function refIsOpen(element) {
      return !!refSearch[element.fieldName]?.open;
    }

    function refQuery(element) {
      return refSearch[element.fieldName]?.query || '';
    }

    // --- Single Ref helpers ---

    // Label shown in the input, derived from the currently selected id
    function refSelectedLabel(element) {
      const id = formData[element.fieldName];
      if (id === '' || id === null || id === undefined) return '';
      const opt = getSelectOptions(element).find(o => parseInt(o.id) === parseInt(id));
      return opt ? opt.label : '';
    }

    // Typed query while open, selected label when closed
    function refInputValue(element) {
      const state = refSearch[element.fieldName];
      return state?.open ? state.query : refSelectedLabel(element);
    }

    function isRefOptionSelected(element, opt) {
      return parseInt(formData[element.fieldName]) === parseInt(opt.id);
    }

    function selectRefOption(element, opt) {
      const state = refState(element.fieldName);
      formData[element.fieldName] = opt.id;
      state.query = '';
      state.open = false;
    }

    function clearRefOption(element) {
      const state = refState(element.fieldName);
      formData[element.fieldName] = '';
      state.query = '';
      state.open = false;
    }

    // --- RefList (multiple) helpers ---

    function isRefSelected(element, opt) {
      const arr = formData[element.fieldName] || [];
      return arr.some(v => parseInt(v) === parseInt(opt.id));
    }

    // Selected options as {id, label} for rendering chips
    function selectedRefOptions(element) {
      const arr = formData[element.fieldName] || [];
      const opts = getSelectOptions(element);
      return arr
        .map(v => opts.find(o => parseInt(o.id) === parseInt(v)))
        .filter(Boolean);
    }

    // Add or remove an option from the selection (dropdown stays open)
    function toggleRefOption(element, opt) {
      const col = element.fieldName;
      if (!Array.isArray(formData[col])) formData[col] = [];
      const arr = formData[col];
      const idx = arr.findIndex(v => parseInt(v) === parseInt(opt.id));
      if (idx === -1) {
        arr.push(opt.id);
      } else {
        arr.splice(idx, 1);
      }
      refState(col).query = '';
    }

    function removeRefChip(element, opt) {
      const arr = formData[element.fieldName] || [];
      const idx = arr.findIndex(v => parseInt(v) === parseInt(opt.id));
      if (idx !== -1) arr.splice(idx, 1);
    }

    // -------------------------------------------------------------------------
    // FORM VALIDATION
    // -------------------------------------------------------------------------

    // Validate a single field, return false if invalid
    // Checks: required fields, numeric format, integer format, max length
    function validateField(element) {
      const col = element.fieldName;
      const meta = columnMetadata.value[col];
      const value = formData[col];

      // Clear previous error state
      delete errors[col];

      // Required field validation
      if (element.required) {
        if (meta?.isBool && !value) {
          errors[col] = 'Ce champ doit être coché';
          return false;
        }
        if (meta?.isMultiple && (!value || value.length === 0)) {
          errors[col] = 'Ce champ est requis';
          return false;
        }
        if (!meta?.isBool && !meta?.isMultiple && (!value || value.toString().trim() === '')) {
          errors[col] = 'Ce champ est requis';
          return false;
        }
      }

      // Numeric validation
      if ((meta?.isNumeric || meta?.isInt) && value && value.toString().trim() !== '') {
        const normalizedVal = value.toString().replace(',', '.');
        const num = parseFloat(normalizedVal);
        if (isNaN(num)) {
          errors[col] = 'Valeur numérique requise';
          return false;
        }
        if (meta?.isInt && !Number.isInteger(num)) {
          errors[col] = 'Valeur entière requise';
          return false;
        }
      }

      // Max length validation (only for text/numeric fields)
      if (element.maxLength && isTextOrNumericField(element) && value && value.length > element.maxLength) {
        errors[col] = `Maximum ${element.maxLength} caractères`;
        return false;
      }

      return true;
    }

    // -------------------------------------------------------------------------
    // FORM SUBMISSION
    // -------------------------------------------------------------------------

    // Handle form submission: validate, collect values, create record, reset form
    async function submitForm() {
      // Hide any previous error/success messages
      formErrorMessage.value = '';
      formSuccessMessage.value = '';

      // Clear all errors
      Object.keys(errors).forEach(key => delete errors[key]);

      // Validate all visible fields (hidden conditional fields are skipped)
      let valid = true;
      for (const element of formElements.value) {
        if (element.type === 'field' && shouldShowField(element)) {
          if (!validateField(element)) {
            valid = false;
          }
        }
      }

      if (!valid) {
        formErrorMessage.value = 'Il y a une ou plusieurs erreurs dans le formulaire';
        return;
      }

      // Collect field values, converting to appropriate Grist types
      const fields = {};
      for (const element of formElements.value) {
        if (element.type !== 'field') continue;
        if (!shouldShowField(element)) continue;

        const col = element.fieldName;
        const meta = columnMetadata.value[col];
        let value = formData[col];

        // Skip attachments here, handled separately
        if (meta?.isAttachment) continue;

        // Boolean: return checkbox state
        if (meta?.isBool) {
          fields[col] = value;
        // ChoiceList/RefList: return Grist list format ['L', val1, val2, ...]
        } else if (meta?.isMultiple) {
          const arr = value || [];
          const values = meta.isRef ? arr.map(v => parseInt(v)) : arr;
          fields[col] = ['L', ...values];
        // Ref: return integer ID or null
        } else if (meta?.isRef) {
          fields[col] = value ? parseInt(value) : null;
        // Numeric: parse float, accepting comma as decimal separator
        } else if (meta?.isNumeric || meta?.isInt) {
          fields[col] = value ? parseFloat(value.toString().replace(',', '.')) : null;
        // Date/DateTime: convert to timestamp in seconds
        } else if (meta?.isDate || meta?.isDateTime) {
          fields[col] = value ? Math.floor(new Date(value).getTime() / 1000) : null;
        // Default (text): return sanitized string
        } else {
          fields[col] = value?.toString().trim() || null;
        }
      }

      try {
        // Upload attachments first
        for (const element of formElements.value) {
          if (element.type === 'field' && shouldShowField(element)) {
            const col = element.fieldName;
            const meta = columnMetadata.value[col];
            if (meta?.isAttachment) {
              const attachmentValue = await uploadAttachments(col);
              if (attachmentValue) {
                fields[col] = attachmentValue;
              }
            }
          }
        }

        // Create new record
        await grist.selectedTable.create({ fields });

        // Show success message
        formSuccessMessage.value = 'Votre réponse a bien été enregistrée';
        setTimeout(() => {
          formSuccessMessage.value = '';
        }, 3000);

        // Reset form: clear all inputs based on their type
        formElements.value.forEach(el => {
          if (el.type === 'field') {
            const meta = columnMetadata.value[el.fieldName];

            if (meta?.isAttachment) {
              pendingAttachments[el.fieldName] = [];
            } else {
              formData[el.fieldName] = defaultValue(meta);
            }
          }
        });
      } catch (error) {
        formErrorMessage.value = 'Erreur : ' + error.message;
      }
    }

    // -------------------------------------------------------------------------
    // RETURN ALL REACTIVE DATA AND METHODS
    // -------------------------------------------------------------------------

    return {
      // State
      columns,
      columnMetadata,
      formElements,
      formData,
      errors,
      pendingAttachments,
      showConfigModal,
      showOverlay,
      globalFont,
      globalPadding,
      formErrorMessage,
      formSuccessMessage,
      newElementType,
      selectedColumn,
      newElementContent,
      dragOverIndex,
      dragPosition,
      editPopup,
      filterPopup,
      validationPopup,
      richEditor,
      colorPicker,
      emojiPicker,
      editorColors,
      emojis,
      activeFormats,

      // Computed
      containerStyle,
      availableColumns,
      conditionalFields: eligibleFieldsForConditions,

      // Methods
      formatFileSize,
      triggerFileInput,
      onFileSelect,
      removeAttachment,
      saveConfiguration,
      addElement,
      removeElement,
      toggleRequired,
      onDragStart,
      onDragEnd,
      onDragOver,
      onDrop,
      closeAllPopups,
      editLabel,
      editContent,
      saveEdit,
      execCmd,
      applyFormat,
      insertLink,
      toggleEmojiPicker,
      insertEmoji,
      toggleColorPicker,
      applyColor,
      removeColor,
      onEditorKeydown,
      onEditorSelect,
      closePickersOnClickOutside,
      closeEditPopup,
      saveRichEdit,
      showFilterPopup,
      updateFilterValues,
      saveFilter,
      deleteFilter,
      isTextOrNumericField,
      isPureTextField,
      showValidationPopup,
      saveValidation,
      deleteValidation,
      toggleMultiline,
      shouldShowField,
      getLabelHtml,
      hasSelectOptions,
      getSelectOptions,
      refIsOpen,
      refQuery,
      filteredRefOptions,
      openRefSearch,
      onRefSearchInput,
      closeRefSearch,
      refInputValue,
      highlightRefLabel,
      isRefOptionSelected,
      selectRefOption,
      clearRefOption,
      isRefSelected,
      selectedRefOptions,
      toggleRefOption,
      removeRefChip,
      submitForm
    };
  }
});

// Mount the app and store reference for grist.ready() callback
vueApp = app.mount('#app');
