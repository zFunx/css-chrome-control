let currentDomain = '';
let currentTabId = null;
let snippets = [];
let editingId = null;

const dom = {
  domain: document.getElementById('current-domain'),
  list: document.getElementById('snippet-list'),
  empty: document.getElementById('empty-state'),
  editor: document.getElementById('editor-container'),
  editorTitle: document.getElementById('editor-title'),
  nameInput: document.getElementById('snippet-name'),
  codeInput: document.getElementById('snippet-code'),
  charCount: document.getElementById('char-count'),
  btnBack: document.getElementById('btn-back'),
  btnAdd: document.getElementById('btn-add-new'),
  btnEnableAll: document.getElementById('btn-enable-all'),
  btnDisableAll: document.getElementById('btn-disable-all'),
  btnRemoveAll: document.getElementById('btn-remove-all')
};

// Initialize
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;
  
  currentTabId = tab.id;
  try {
    currentDomain = new URL(tab.url).hostname;
    dom.domain.textContent = currentDomain;
    await loadSnippets();
    render();
  } catch (e) {
    dom.domain.textContent = "Invalid Domain";
  }
}

async function loadSnippets() {
  const key = `css_${currentDomain}`;
  const data = await chrome.storage.local.get([key]);
  snippets = data[key] || [];
}

async function saveSnippets() {
  const key = `css_${currentDomain}`;
  await chrome.storage.local.set({ [key]: snippets });
  applyToTab();
}

function applyToTab() {
  const activeCss = snippets
    .filter(s => s.enabled)
    .sort((a, b) => a.order - b.order)
    .map(s => `/* ${s.name} */\n${s.content}`)
    .join('\n\n');

  chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    func: (cssText) => {
      let styleEl = document.getElementById('css-chrome-control-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'css-chrome-control-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = cssText;
    },
    args: [activeCss]
  }).catch(err => console.error("Injection error:", err));
}

// Render
function render() {
  document.body.appendChild(dom.editor); // Park editor safely before clearing list
  dom.list.innerHTML = '';
  
  if (snippets.length === 0) {
    dom.empty.style.display = 'block';
  } else {
    dom.empty.style.display = 'none';
    snippets.sort((a, b) => a.order - b.order).forEach((snippet, index) => {
      const el = document.createElement('div');
      el.className = 'snippet-item';
      if (snippet.id === editingId) el.classList.add('active');
      el.draggable = true;
      el.dataset.id = snippet.id;
      
      el.innerHTML = `
        <div class="drag-handle">⋮⋮</div>
        <div class="snippet-content">
          <h4 class="snippet-name">${snippet.name}</h4>
        </div>
        <div class="snippet-actions">
          <button class="icon-btn edit" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <label class="toggle">
            <input type="checkbox" class="toggle-cb" ${snippet.enabled ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
          <button class="icon-btn delete" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

      // Events
      el.querySelector('.toggle-cb').addEventListener('change', (e) => {
        snippet.enabled = e.target.checked;
        saveSnippets();
      });

      el.querySelector('.edit').addEventListener('click', () => openEditor(snippet.id));
      
      el.querySelector('.delete').addEventListener('click', () => {
        if (confirm(`Delete snippet "${snippet.name}"?`)) {
          snippets = snippets.filter(s => s.id !== snippet.id);
          saveSnippets().then(render);
        }
      });

      // Drag and Drop
      el.addEventListener('dragstart', handleDragStart);
      el.addEventListener('dragover', handleDragOver);
      el.addEventListener('drop', handleDrop);
      el.addEventListener('dragend', handleDragEnd);

      dom.list.appendChild(el);
      if (snippet.id === editingId) {
        dom.list.appendChild(dom.editor);
      }
    });
  }
  
  if (isNewSnippet && editingId) {
    dom.list.appendChild(dom.editor);
  }
}

// Drag and Drop logic
let dragSrcEl = null;

function handleDragStart(e) {
  dragSrcEl = this;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.id);
  this.classList.add('dragging');
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDrop(e) {
  e.stopPropagation();
  if (dragSrcEl !== this) {
    const draggedId = dragSrcEl.dataset.id;
    const targetId = this.dataset.id;
    
    const draggedIdx = snippets.findIndex(s => s.id === draggedId);
    const targetIdx = snippets.findIndex(s => s.id === targetId);
    
    // Swap or reorder
    const [removed] = snippets.splice(draggedIdx, 1);
    snippets.splice(targetIdx, 0, removed);
    
    // Update order values
    snippets.forEach((s, idx) => s.order = idx);
    
    saveSnippets().then(render);
  }
  return false;
}

function handleDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.snippet-item').forEach(el => el.classList.remove('dragging'));
}

// Editor setup
let cmEditor = null;

function initCodeMirror() {
  if (!cmEditor) {
    cmEditor = CodeMirror.fromTextArea(dom.codeInput, {
      mode: "css",
      theme: "material-darker",
      lineNumbers: false,
      lineWrapping: true
    });

    cmEditor.on("beforeChange", function(cm, change) {
      if (change.origin === "paste" || change.origin === "+input") {
        const newText = change.text.join("\n");
        const currentLen = cm.getValue().length;
        const replaceLen = change.removed ? change.removed.join("\n").length : 0;
        
        if (currentLen - replaceLen + newText.length > 500) {
          const allowedLen = 500 - (currentLen - replaceLen);
          if (allowedLen > 0) {
            change.update(change.from, change.to, newText.substring(0, allowedLen).split("\n"));
          } else {
            change.cancel();
          }
        }
      }
    });
    
    cmEditor.on("change", () => {
      updateCharCount();
      triggerAutoSave();
    });
  }
}

let isNewSnippet = false;

function openEditor(id = null) {
  dom.editor.classList.remove('hidden');
  dom.btnAdd.style.display = 'none';
  
  document.querySelectorAll('.snippet-item').forEach(el => el.classList.remove('active'));
  
  if (!cmEditor) initCodeMirror();
  
  if (id) {
    editingId = id;
    isNewSnippet = false;
    const snippet = snippets.find(s => s.id === id);
    dom.editorTitle.textContent = 'Edit Snippet';
    dom.nameInput.value = snippet.name;
    cmEditor.setValue(snippet.content || '');
    
    const el = document.querySelector(`.snippet-item[data-id="${id}"]`);
    if (el) {
      el.classList.add('active');
      el.after(dom.editor);
    }
  } else {
    editingId = Date.now().toString();
    isNewSnippet = true;
    dom.editorTitle.textContent = 'New Snippet';
    dom.nameInput.value = '';
    cmEditor.setValue('');
    dom.list.appendChild(dom.editor);
  }
  
  setTimeout(() => cmEditor.refresh(), 10);
  updateCharCount();
}

function closeEditor() {
  // If user typed nothing in a new snippet, it's not saved anyway
  dom.editor.classList.add('hidden');
  dom.btnAdd.style.display = 'block';
  editingId = null;
  isNewSnippet = false;
  document.querySelectorAll('.snippet-item').forEach(el => el.classList.remove('active'));
}

let autoSaveTimeout = null;
function triggerAutoSave() {
  if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
  autoSaveTimeout = setTimeout(async () => {
    if (!editingId) return;
    
    const name = dom.nameInput.value.trim() || 'Untitled';
    const content = cmEditor ? cmEditor.getValue() : '';
    
    let snippet = snippets.find(s => s.id === editingId);
    if (!snippet) {
      if (!content.trim() && name === 'Untitled') return; // skip if completely empty
      
      snippet = {
        id: editingId,
        name,
        content,
        enabled: true,
        order: snippets.length
      };
      snippets.push(snippet);
      isNewSnippet = false;
    } else {
      snippet.name = name;
      snippet.content = content;
    }
    
    await saveSnippets();
    render();
  }, 300);
}

function updateCharCount() {
  const len = cmEditor ? cmEditor.getValue().length : 0;
  dom.charCount.textContent = `${len} / 500`;
  if (len >= 500) {
    dom.charCount.style.color = 'var(--danger)';
  } else {
    dom.charCount.style.color = 'var(--text-muted)';
  }
}

// Event Listeners
dom.btnAdd.addEventListener('click', () => openEditor());
dom.btnBack.addEventListener('click', closeEditor);
dom.nameInput.addEventListener('input', triggerAutoSave);

dom.btnEnableAll.addEventListener('click', async () => {
  snippets.forEach(s => s.enabled = true);
  await saveSnippets();
  render();
});

dom.btnDisableAll.addEventListener('click', async () => {
  snippets.forEach(s => s.enabled = false);
  await saveSnippets();
  render();
});

dom.btnRemoveAll.addEventListener('click', async () => {
  if (confirm('Are you sure you want to remove all snippets for this domain?')) {
    snippets = [];
    await saveSnippets();
    render();
  }
});

// Boot
document.addEventListener('DOMContentLoaded', init);
