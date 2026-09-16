const STORAGE_KEY = 'passman_credentials_v1';
const VAULT_KEY = 'passman_encrypted_vault_v2';
const MASTER_WRAPPER_KEY = 'passman_master_wrapper_v1';
const RECOVERY_WRAPPER_KEY = 'passman_recovery_wrapper_v1';
const THEME_KEY = 'passman_theme';
const MASTER_HASH_KEY = 'passman_master_hash';
const MASTER_SALT_KEY = 'passman_master_salt';
const SESSION_KEY = 'passman_session_expires';
const SESSION_DURATION = 60 * 60 * 1000;
const KDF_ITERATIONS = 600000;
const MASTER_PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

const $ = (selector) => document.querySelector(selector);
const state = { entries: [], query: '', reveal: new Set() };
let activeVaultKey = null;
let activeVaultSalt = null;
let recoveryCandidate = null;

function moveEntry(entries, sourceId, targetId, placeAfter) {
  const sourceIndex = entries.findIndex(entry => entry.id === sourceId);
  const targetIndexBeforeRemoval = entries.findIndex(entry => entry.id === targetId);
  if (sourceIndex < 0 || targetIndexBeforeRemoval < 0 || sourceId === targetId) return entries;
  const reordered = [...entries];
  const [moved] = reordered.splice(sourceIndex, 1);
  const targetIndex = reordered.findIndex(entry => entry.id === targetId);
  reordered.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved);
  return reordered;
}

function buildRecoveryFile(recoveryId, recoverySecret) {
  return { app:'Pass-Man', type:'recovery-key', version:1, recoveryId, recoverySecret, createdAt:new Date().toISOString() };
}

function toggleSidebar(shell, button) {
  const collapsed = shell.classList.toggle('sidebar-collapsed');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expandir menu' : 'Recolher menu');
  localStorage.setItem('passman_sidebar_collapsed', String(collapsed));
}

function loadEntries() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function deriveEncryptionKey(password, salt, iterations = KDF_ITERATIONS) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations, hash:'SHA-256' },
    material,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptEntries(entries, key, salt, iterations = KDF_ITERATIONS) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ entries }));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext);
  return {
    app:'Pass-Man',
    version:2,
    encryption:{ algorithm:'AES-256-GCM', kdf:'PBKDF2-HMAC-SHA-256', iterations },
    salt:bytesToBase64(salt),
    iv:bytesToBase64(iv),
    ciphertext:bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptEnvelope(envelope, password) {
  if (!envelope || envelope.version !== 2 || !envelope.salt || !envelope.iv || !envelope.ciphertext) throw new Error('Formato criptografado inválido.');
  if (envelope.encryption?.algorithm !== 'AES-256-GCM' || envelope.encryption?.kdf !== 'PBKDF2-HMAC-SHA-256') throw new Error('Algoritmo de backup não suportado.');
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error('Parâmetros criptográficos inválidos.');
  const iterations = Number(envelope.encryption?.iterations);
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 5000000) throw new Error('Parâmetros criptográficos inválidos.');
  const key = await deriveEncryptionKey(password, salt, iterations);
  const plaintext = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv },
    key,
    base64ToBytes(envelope.ciphertext)
  );
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (!Array.isArray(payload.entries)) throw new Error('Conteúdo do cofre inválido.');
  return { entries:payload.entries, key, salt };
}

async function encryptVaultSecret(vaultSecret, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveEncryptionKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ vaultSecret }));
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, plaintext);
  return { app:'Pass-Man', type:'vault-key-wrapper', version:1, encryption:{ algorithm:'AES-256-GCM', kdf:'PBKDF2-HMAC-SHA-256', iterations:KDF_ITERATIONS }, salt:bytesToBase64(salt), iv:bytesToBase64(iv), ciphertext:bytesToBase64(new Uint8Array(ciphertext)) };
}

async function decryptVaultSecret(wrapper, password) {
  if (!wrapper || wrapper.app !== 'Pass-Man' || wrapper.type !== 'vault-key-wrapper' || wrapper.version !== 1) throw new Error('Arquivo de recuperação inválido.');
  const salt = base64ToBytes(wrapper.salt);
  const iv = base64ToBytes(wrapper.iv);
  const key = await deriveEncryptionKey(password, salt, Number(wrapper.encryption?.iterations));
  const plaintext = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, base64ToBytes(wrapper.ciphertext));
  const payload = JSON.parse(new TextDecoder().decode(plaintext));
  if (typeof payload.vaultSecret !== 'string' || !payload.vaultSecret) throw new Error('Arquivo de recuperação inválido.');
  return payload.vaultSecret;
}

function randomSecret() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))); }

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function createRecoveryFile(vaultSecret) {
  const recoverySecret = randomSecret();
  const recoveryId = crypto.randomUUID();
  const wrapper = await encryptVaultSecret(vaultSecret, recoverySecret);
  wrapper.recoveryId = recoveryId;
  localStorage.setItem(RECOVERY_WRAPPER_KEY, JSON.stringify(wrapper));
  downloadJson(buildRecoveryFile(recoveryId, recoverySecret), `passman-chave-recuperacao-${new Date().toISOString().slice(0,10)}.json`);
}

async function createNewVault(masterPassword, entries = []) {
  const vaultSecret = randomSecret();
  activeVaultSalt = crypto.getRandomValues(new Uint8Array(16));
  activeVaultKey = await deriveEncryptionKey(vaultSecret, activeVaultSalt);
  state.entries = entries;
  await persist();
  localStorage.setItem(MASTER_WRAPPER_KEY, JSON.stringify(await encryptVaultSecret(vaultSecret, masterPassword)));
  await createRecoveryFile(vaultSecret);
}

async function persist() {
  if (!activeVaultKey || !activeVaultSalt) throw new Error('Cofre bloqueado.');
  const envelope = await encryptEntries(state.entries, activeVaultKey, activeVaultSalt);
  localStorage.setItem(VAULT_KEY, JSON.stringify(envelope));
}

function escapeHtml(value = '') {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' }).format(new Date(iso));
}

function mask(password) { return '•'.repeat(Math.min(Math.max(password.length, 8), 18)); }

function validateMasterPassword(password) {
  return MASTER_PASSWORD_RULE.test(password)
    ? ''
    : 'Use ao menos 8 caracteres, incluindo maiúscula, minúscula, número e caractere especial.';
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function deriveMasterKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:210000, hash:'SHA-256' }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

async function saveMasterKey(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveMasterKey(password, salt);
  localStorage.setItem(MASTER_SALT_KEY, bytesToBase64(salt));
  localStorage.setItem(MASTER_HASH_KEY, hash);
}

async function verifyMasterKey(password) {
  const hash = localStorage.getItem(MASTER_HASH_KEY);
  const salt = localStorage.getItem(MASTER_SALT_KEY);
  if (!hash || !salt) return false;
  return (await deriveMasterKey(password, base64ToBytes(salt))) === hash;
}

function startSession() {
  sessionStorage.setItem(SESSION_KEY, String(Date.now() + SESSION_DURATION));
  $('#lockScreen').classList.add('unlocked');
}

function configureLockScreen() {
  activeVaultKey = null;
  activeVaultSalt = null;
  state.entries = [];
  state.reveal.clear();
  closeModal();
  if ($('#exportForm')) $('#exportForm').reset();
  if ($('#exportModal')) $('#exportModal').classList.remove('open');
  render();
  showUnlockMode('login');
  $('#masterError').textContent = '';
  $('#lockScreen').classList.remove('unlocked');
  $('#lockScreen').dataset.configured = 'true';
  setTimeout(() => $('#masterPassword').focus(), 50);
}

function setPasswordVisibility(inputId, buttonId, visible = false) {
  const input = $(inputId); const button = $(buttonId);
  input.type = visible ? 'text' : 'password';
  button.innerHTML = eyeIcon(visible);
  button.title = visible ? 'Ocultar chave mestra' : 'Mostrar chave mestra';
  button.setAttribute('aria-label', button.title);
}

function showUnlockMode(mode) {
  const hasVault = Boolean(localStorage.getItem(VAULT_KEY) || localStorage.getItem(MASTER_HASH_KEY));
  const allowedMode = mode;
  $('#masterForm').reset();
  $('#unlockMode').value = allowedMode;
  $('#masterError').textContent = '';
  if (allowedMode !== 'recovery-reset') {
    $('#recoveryFile').value = '';
    recoveryCandidate = null;
  }
  $('#loginFields').hidden = allowedMode !== 'login';
  $('#setupFields').hidden = allowedMode === 'login';
  $('#recoveryUpload').hidden = allowedMode !== 'recovery-upload';
  $('#recoverySetupNotice').hidden = allowedMode !== 'recovery-reset';
  $('#unlockActions').hidden = allowedMode !== 'login';
  $('#resetVaultBtn').hidden = !hasVault || allowedMode !== 'login';
  $('#masterSubmit').hidden = allowedMode === 'login' || allowedMode === 'recovery-upload';
  $('#masterPassword').disabled = allowedMode !== 'login';
  $('#masterSetupPassword').disabled = !['first', 'recovery-reset'].includes(allowedMode);
  $('#masterConfirm').disabled = !['first', 'recovery-reset'].includes(allowedMode);
  $('#unlockTitle').textContent = allowedMode === 'login' ? 'Cofre bloqueado' : allowedMode === 'first' ? 'Primeiro acesso' : allowedMode === 'recovery-upload' ? 'Recuperar acesso' : 'Definir nova chave';
  $('#unlockDescription').textContent = allowedMode === 'login'
    ? 'Informe sua chave mestra para acessar o cofre.'
    : allowedMode === 'first'
      ? 'Escolha e confirme uma chave mestra. Em seguida, baixe a chave de recuperação antes de entrar.'
      : allowedMode === 'recovery-upload'
        ? 'Envie a chave de recuperação gerada pelo Pass-Man para validar sua identidade.'
        : 'Defina uma nova chave mestra. Uma nova chave de recuperação será baixada antes de entrar.';
  $('#masterSubmit').textContent = allowedMode === 'login' ? 'Entrar' : allowedMode === 'recovery-upload' ? 'Validar chave de recuperação' : 'Criar e baixar chave de recuperação';
  setPasswordVisibility('#masterPassword', '#toggleMasterPassword');
  setPasswordVisibility('#masterSetupPassword', '#toggleSetupPassword');
  setPasswordVisibility('#masterConfirm', '#toggleMasterConfirm');
  setTimeout(() => (allowedMode === 'recovery-upload' ? $('#recoveryFile') : allowedMode === 'login' ? $('#masterPassword') : $('#masterSetupPassword')).focus(), 50);
}

function checkSession() {
  const expires = Number(sessionStorage.getItem(SESSION_KEY) || 0);
  const hasVault = localStorage.getItem(VAULT_KEY) || localStorage.getItem(MASTER_HASH_KEY);
  if (!hasVault || Date.now() >= expires || !activeVaultKey) {
    sessionStorage.removeItem(SESSION_KEY);
    if (!$('#lockScreen').dataset.configured || $('#lockScreen').classList.contains('unlocked')) configureLockScreen();
  }
}

function eyeIcon(open) {
  return open
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.2A11 11 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.1 2.8M6.4 6.4C3.5 8.2 2 12 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
}

function render() {
  const filtered = state.entries.filter(e => [e.title,e.login,e.system,e.area,e.owner,e.supplier,e.criticality].join(' ').toLowerCase().includes(state.query.toLowerCase()));
  $('#credentialsGrid').innerHTML = filtered.map(entry => {
    const shown = state.reveal.has(entry.id);
    const quality = passwordQuality(entry.password);
    const strength = quality < 40 ? 'weak' : quality < 65 ? 'medium' : 'strong';
    const needsAttention = strength !== 'strong';
    const monsterLabel = strength === 'weak' ? 'Senha fraca' : 'Senha média';
    return `<article class="credential-card ${needsAttention?'needs-attention':''}" draggable="true" data-card-id="${entry.id}" title="Arraste para reorganizar">
      <div class="card-top"><span class="access-icon">⌁</span><div class="card-title"><h3>${escapeHtml(entry.title)}</h3><small>ACESSO OT</small></div>${needsAttention?`<span class="weak-monster ${strength}" title="${monsterLabel}" aria-label="${monsterLabel}"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 15a11 11 0 0 1 22 0v12l-4-3-4 3-3-3-3 3-4-3-4 3Z"/><circle cx="12" cy="15" r="2"/><circle cx="21" cy="15" r="2"/><path d="M12 21h9"/></svg></span>`:`<span class="happy-chomper" title="Senha forte" aria-label="Senha forte"><svg viewBox="0 0 32 32" aria-hidden="true"><path class="happy-body" d="M16 16L28 9A14 14 0 1 0 28 23Z"/><path class="happy-eye" d="M9 11q3-3 6 0"/></svg></span>`}</div>
      <div class="credential-fields">
        <div class="field-line"><div><label>LOGIN / USUÁRIO</label><code class="credential-value">${escapeHtml(entry.login)}</code></div><button class="copy-action" data-copy="login" data-id="${entry.id}" title="Copiar login">▣ Copiar</button></div>
        <div class="field-line"><div><label>SENHA</label><code class="credential-value ${shown ? 'revealed' : ''}">${shown ? escapeHtml(entry.password) : mask(entry.password)}</code></div><div><button class="eye-action" data-reveal="${entry.id}" title="${shown ? 'Ocultar' : 'Mostrar'} senha" aria-label="${shown ? 'Ocultar' : 'Mostrar'} senha">${eyeIcon(shown)}</button> <button class="copy-action" data-copy="password" data-id="${entry.id}" title="Copiar senha">▣ Copiar</button></div></div>
      </div>
      <div class="card-classification">
        <span class="criticality ${escapeHtml((entry.criticality||'Média').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''))}">${escapeHtml(entry.criticality||'Média')}</span>
        ${entry.system?`<span title="Sistema">${escapeHtml(entry.system)}</span>`:''}
        ${entry.area?`<span title="Área">${escapeHtml(entry.area)}</span>`:''}
      </div>
      <dl class="card-details">
        ${entry.owner?`<div><dt>PROPRIETÁRIO</dt><dd>${escapeHtml(entry.owner)}</dd></div>`:''}
        ${entry.supplier?`<div><dt>FORNECEDOR</dt><dd>${escapeHtml(entry.supplier)}</dd></div>`:''}
      </dl>
      <div class="card-footer"><span>ATUALIZADO ${formatDate(entry.updatedAt)}</span><div class="card-actions"><button class="edit" data-edit="${entry.id}">EDITAR</button><button class="delete" data-delete="${entry.id}">EXCLUIR</button></div></div>
    </article>`;
  }).join('');
  $('#emptyState').hidden = filtered.length > 0;
  $('#credentialsGrid').hidden = filtered.length === 0;
  $('#totalStat').textContent = state.entries.length;
  $('#navCount').textContent = state.entries.length;
  $('#resultCount').textContent = `${filtered.length} ${filtered.length === 1 ? 'ACESSO' : 'ACESSOS'}`;
  const latest = [...state.entries].sort((a,b) => new Date(b.updatedAt)-new Date(a.updatedAt))[0];
  $('#lastChange').textContent = latest ? formatDate(latest.updatedAt) : '—';
  updateScore();
}

function passwordQuality(password) {
  if (!password) return 0;
  let score = Math.min(55, password.length * 3);
  if (/[a-z]/.test(password)) score += 9;
  if (/[A-Z]/.test(password)) score += 9;
  if (/\d/.test(password)) score += 9;
  if (/[^A-Za-z0-9]/.test(password)) score += 13;
  if (password.length >= 16) score += 10;
  if (/(.)\1{2,}/.test(password)) score -= 15;
  if (/1234|qwerty|admin|senha|password/i.test(password)) score -= 30;
  return Math.max(0, Math.min(100, score));
}

function updateScore() {
  if (!$('#scoreValue')) return;
  const qualities = state.entries.map(entry => passwordQuality(entry.password));
  const average = qualities.length ? Math.round(qualities.reduce((a,b)=>a+b,0) / qualities.length) : 0;
  const strong = qualities.filter(value => value >= 65).length;
  const score = state.entries.length * 100 + qualities.reduce((sum,value)=>sum + value * 3,0);
  const levels = [
    { min:0, name:'Iniciante', title:'Comece sua jornada', message:'Cada credencial protegida é um passo para um ambiente operacional mais seguro.' },
    { min:500, name:'Básico', title:'A proteção está tomando forma', message:'Você já demonstra atenção consistente às suas credenciais.' },
    { min:1500, name:'Intermediário', title:'Bom progresso no cofre', message:'Seu cofre mostra dedicação e escolhas de senha cada vez mais fortes.' },
    { min:3000, name:'Avançado', title:'Proteção em alto nível', message:'Você mantém um conjunto relevante de credenciais com boa qualidade.' },
    { min:6000, name:'Expert', title:'Proteção consistente', message:'Seu cuidado com a organização e a força das senhas está em um nível elevado.' },
    { min:9000, name:'Master', title:'Dedicação excepcional', message:'Seu cuidado com volume, qualidade e exclusividade das credenciais atingiu o nível máximo.' }
  ];
  let index = levels.findLastIndex(level => score >= level.min);
  if (index < 0) index = 0;
  const level = levels[index];
  const next = levels[index + 1];
  const progress = next ? ((score-level.min)/(next.min-level.min))*100 : 100;
  $('#scoreValue').textContent = score.toLocaleString('pt-BR');
  $('#mainScore').textContent = score.toLocaleString('pt-BR') + ' pontos';
  $('#mainLevel').textContent = level.name;
  const levelColors = ['var(--green)', 'var(--arcade-blue)', 'var(--arcade-yellow)', 'var(--amber)', 'var(--arcade-red)', 'var(--arcade-pink)'];
  const levelDot = $('.level-dot');
  if (levelDot) {
    levelDot.style.background = levelColors[index];
    levelDot.style.boxShadow = '0 0 13px ' + levelColors[index];
  }
  $('.score-orbit').style.setProperty('--score-angle', (progress * 3.6) + 'deg');
  $('#scoreLevelLabel').textContent = 'NÍVEL ' + level.name.toUpperCase();
  $('#scoreTitle').textContent = level.title;
  $('#scoreMessage').textContent = level.message;
  $('#scoreProgress').style.width = Math.min(100,progress) + '%';
  $('#nextLevelText').textContent = next ? (next.min-score) + ' pontos para alcançar ' + next.name : 'Você alcançou o nível máximo.';
  $('#scoreEntries').textContent = state.entries.length;
  $('#averageStrength').textContent = average + '%';
  $('#strongPasswords').textContent = strong;
  const duplicates = state.entries.length - new Set(state.entries.map(entry=>entry.password)).size;
  const weak = qualities.filter(value=>value<40).length;
  const advice = [];
  if (!state.entries.length) advice.push('Cadastre seu primeiro acesso para começar a pontuar.');
  if (state.entries.length > 0 && state.entries.length < 5) advice.push('Continue organizando seus acessos no cofre; cada card protegido soma 100 pontos.');
  if (weak) advice.push('Revise ' + weak + ' senha(s) fraca(s). Prefira senhas mais longas e combine diferentes tipos.');
  if (duplicates) advice.push('Existem ' + duplicates + ' senha(s) reutilizada(s). Crie uma senha exclusiva para cada acesso.');
  if (state.entries.length && !weak && !duplicates) advice.push('Excelente: suas senhas cadastradas estão fortes e não há reutilização detectada.');
  if (average >= 75) advice.push('Sua média de força está muito boa. Mantenha revisões periódicas e revogue acessos desnecessários.');
  $('#scoreAdvice').innerHTML = advice.map(text => '<div class="advice-row"><b>›</b><p>' + escapeHtml(text) + '</p></div>').join('');
  $('#levelsGrid').innerHTML = levels.map((item,i) => '<div class="level-item ' + (i===index?'active':'') + '"><b>' + item.min.toLocaleString('pt-BR') + '+</b><span>' + item.name + '</span></div>').join('');
}

function showToast(message, error = false) {
  const toast = $('#toast');
  toast.querySelector('p').textContent = message;
  toast.classList.toggle('error', error);
  toast.querySelector('span').textContent = error ? '!' : '✓';
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function openModal(entry = null) {
  $('#entryForm').reset();
  $('#entryId').value = entry?.id || '';
  $('#entryTitle').value = entry?.title || '';
  $('#entryLogin').value = entry?.login || '';
  $('#entryPassword').value = entry?.password || '';
  $('#entryCriticality').value = entry?.criticality || 'Média';
  $('#entrySystem').value = entry?.system || '';
  $('#entryArea').value = entry?.area || '';
  $('#entryOwner').value = entry?.owner || '';
  $('#entrySupplier').value = entry?.supplier || '';
  $('#entryPassword').type = 'password';
  $('#toggleFormPassword').innerHTML = eyeIcon(false);
  $('#toggleFormPassword').title = 'Mostrar senha';
  $('#toggleFormPassword').setAttribute('aria-label', 'Mostrar senha');
  $('#modalTitle').textContent = entry ? 'Editar acesso' : 'Novo acesso';
  $('#entryModal').classList.add('open');
  $('#entryModal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#entryTitle').focus(), 50);
}

function closeModal() {
  $('#entryModal').classList.remove('open');
  $('#entryModal').setAttribute('aria-hidden', 'true');
}

let clipboardClearTimer = null;
async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    clearTimeout(clipboardClearTimer);
    clipboardClearTimer = setTimeout(async () => {
      try {
        await navigator.clipboard.writeText('');
        showToast('Área de transferência limpa por segurança.');
      } catch {
        showToast('O navegador não permitiu limpar a área de transferência.', true);
      }
    }, 2 * 60 * 1000);
    showToast(message + ' Limpeza agendada para 2 minutos.');
  }
  catch { showToast('Não foi possível copiar automaticamente.', true); }
}

function secureRandom(max) {
  const limit = Math.floor(256 / max) * max;
  const byte = new Uint8Array(1);
  do { crypto.getRandomValues(byte); } while (byte[0] >= limit);
  return byte[0] % max;
}

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandom(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

function generatePassword() {
  const sets = [];
  if ($('#uppercase').checked) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ');
  if ($('#lowercase').checked) sets.push('abcdefghijkmnopqrstuvwxyz');
  if ($('#numbers').checked) sets.push('23456789');
  if ($('#symbols').checked) sets.push('!@#$%&*+-_=?.');
  if (!sets.length) { $('#lowercase').checked = true; sets.push('abcdefghijkmnopqrstuvwxyz'); showToast('Ao menos um tipo deve estar ativo.', true); }
  const length = Number($('#lengthRange').value);
  const all = sets.join('');
  const chars = sets.map(set => set[secureRandom(set.length)]);
  while (chars.length < length) chars.push(all[secureRandom(all.length)]);
  const password = shuffle(chars).join('');
  $('#generatedPassword').textContent = password;
  updateStrength(password, sets.length);
  return password;
}

function updateStrength(password, variety) {
  const score = passwordQuality(password);
  const label = score >= 80 ? 'MUITO FORTE' : score >= 65 ? 'FORTE' : score >= 40 ? 'MÉDIA' : 'FRACA';
  const color = score >= 65 ? 'var(--green)' : score >= 40 ? 'var(--amber)' : 'var(--danger)';
  $('#strengthBar').style.width = `${score}%`;
  $('#strengthBar').style.background = color;
  $('#strengthLabel').textContent = label;
  $('#strengthLabel').style.color = color;
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-view]').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $(`#${name}View`).classList.add('active');
  $('.sidebar').classList.remove('open');
  if (name === 'generator' && !$('#generatedPassword').textContent) generatePassword();
}

$('#entryForm').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#entryId').value;
  const now = new Date().toISOString();
  const entry = { id: id || crypto.randomUUID(), title: $('#entryTitle').value.trim(), login: $('#entryLogin').value.trim(), password: $('#entryPassword').value, criticality:$('#entryCriticality').value, system:$('#entrySystem').value.trim(), area:$('#entryArea').value.trim(), owner:$('#entryOwner').value.trim(), supplier:$('#entrySupplier').value.trim(), updatedAt: now };
  if (id) state.entries = state.entries.map(item => item.id === id ? entry : item);
  else state.entries.unshift(entry);
  await persist(); render(); closeModal(); showToast(id ? 'Acesso atualizado.' : 'Acesso salvo no cofre.');
});

$('#masterForm').addEventListener('submit', async e => {
  e.preventDefault();
  const password = ['first', 'recovery-reset'].includes($('#unlockMode').value) ? $('#masterSetupPassword').value : $('#masterPassword').value;
  const encryptedVault = localStorage.getItem(VAULT_KEY);
  const legacyMaster = localStorage.getItem(MASTER_HASH_KEY);
  const mode = $('#unlockMode').value;
  $('#masterError').textContent = '';
  $('#masterSubmit').disabled = true;
  try {
    if (mode === 'login') {
      if (!encryptedVault) throw new Error('Use “Primeiro acesso” para criar o seu cofre.');
      const wrapper = localStorage.getItem(MASTER_WRAPPER_KEY);
      if (wrapper) {
        const vaultSecret = await decryptVaultSecret(JSON.parse(wrapper), password);
        const unlocked = await decryptEnvelope(JSON.parse(encryptedVault), vaultSecret);
        activeVaultKey = unlocked.key; activeVaultSalt = unlocked.salt; state.entries = unlocked.entries;
      } else {
        if (legacyMaster && !(await verifyMasterKey(password))) throw new Error('Chave mestra incorreta.');
        const unlocked = await decryptEnvelope(JSON.parse(encryptedVault), password);
        await createNewVault(password, unlocked.entries);
        localStorage.removeItem(MASTER_HASH_KEY); localStorage.removeItem(MASTER_SALT_KEY);
      }
      startSession(); render(); showToast('Cofre desbloqueado.');
    } else if (mode === 'first' || mode === 'recovery-reset') {
      if (mode === 'first' && (encryptedVault || legacyMaster)) throw new Error('Já existe um cofre neste navegador. Entre com sua chave ou use a recuperação para preservar os dados.');
      const validationError = validateMasterPassword(password);
      if (validationError) throw new Error(validationError);
      if (password !== $('#masterConfirm').value) throw new Error('As chaves informadas não coincidem.');
      const entries = mode === 'recovery-reset' ? recoveryCandidate.entries : loadEntries();
      await createNewVault(password, entries);
      localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(MASTER_HASH_KEY); localStorage.removeItem(MASTER_SALT_KEY);
      recoveryCandidate = null;
      startSession(); render();
      showToast('Nova chave de recuperação baixada. Guarde o arquivo em local seguro.');
    } else {
      throw new Error('Escolha uma opção de acesso válida.');
    }
  } catch (error) {
    $('#masterError').textContent = error.message || 'Não foi possível validar a chave.';
  } finally {
    $('#masterSubmit').disabled = false;
  }
});

$('#changeMasterForm').addEventListener('submit', async e => {
  e.preventDefault();
  const current = $('#currentMaster').value;
  const next = $('#newMaster').value;
  const confirmation = $('#confirmNewMaster').value;
  const validationError = validateMasterPassword(next);
  if (validationError) return showToast(validationError, true);
  if (next !== confirmation) return showToast('A confirmação da nova chave não coincide.', true);
  try {
    const wrapper = JSON.parse(localStorage.getItem(MASTER_WRAPPER_KEY));
    const vaultSecret = await decryptVaultSecret(wrapper, current);
    localStorage.setItem(MASTER_WRAPPER_KEY, JSON.stringify(await encryptVaultSecret(vaultSecret, next)));
    e.target.reset();
    startSession();
    showToast('Chave mestra alterada e cofre recifrado.');
  } catch {
    showToast('A chave mestra atual está incorreta.', true);
  }
});

$('#firstAccessBtn').addEventListener('click', () => showUnlockMode('first'));
$('#forgotMasterBtn').addEventListener('click', () => showUnlockMode('recovery-upload'));
$('#backToLoginBtn').addEventListener('click', () => showUnlockMode('login'));
function closeResetVaultModal() {
  $('#resetVaultModal').classList.remove('open');
  $('#resetVaultModal').setAttribute('aria-hidden', 'true');
}
$('#resetVaultBtn').addEventListener('click', () => {
  $('#resetConfirmation').value = '';
  $('#confirmResetVault').disabled = true;
  $('#resetVaultModal').classList.add('open');
  $('#resetVaultModal').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#resetConfirmation').focus(), 50);
});
$('#closeResetVaultModal').addEventListener('click', closeResetVaultModal);
$('#cancelResetVault').addEventListener('click', closeResetVaultModal);
$('#resetVaultModal').addEventListener('click', e => { if (e.target === $('#resetVaultModal')) closeResetVaultModal(); });
$('#resetConfirmation').addEventListener('input', e => { $('#confirmResetVault').disabled = e.target.value !== 'APAGAR'; });
$('#confirmResetVault').addEventListener('click', () => {
  if ($('#resetConfirmation').value !== 'APAGAR') return;
  [STORAGE_KEY, VAULT_KEY, MASTER_WRAPPER_KEY, RECOVERY_WRAPPER_KEY, MASTER_HASH_KEY, MASTER_SALT_KEY, SESSION_KEY].forEach(key => localStorage.removeItem(key));
  sessionStorage.removeItem(SESSION_KEY);
  closeResetVaultModal();
  configureLockScreen();
  showUnlockMode('first');
  showToast('Cofre local apagado. Crie uma nova chave mestra.');
});
$('#recoveryFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  $('#masterError').textContent = '';
  try {
    const recoveryFile = JSON.parse(await file.text());
    if (recoveryFile?.app !== 'Pass-Man' || recoveryFile.type !== 'recovery-key' || recoveryFile.version !== 1 || !recoveryFile.recoverySecret || !recoveryFile.recoveryId) throw new Error('Selecione uma chave de recuperação válida.');
    const stored = JSON.parse(localStorage.getItem(RECOVERY_WRAPPER_KEY) || 'null');
    if (!stored || stored.recoveryId !== recoveryFile.recoveryId) throw new Error('Esta chave de recuperação já foi usada, não pertence a este cofre ou não é mais válida.');
    const vaultSecret = await decryptVaultSecret(stored, recoveryFile.recoverySecret);
    const envelope = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
    const unlocked = await decryptEnvelope(envelope, vaultSecret);
    recoveryCandidate = { entries:unlocked.entries };
    showUnlockMode('recovery-reset');
  } catch (error) {
    $('#masterError').textContent = error.message || 'Não foi possível validar a chave de recuperação.';
    e.target.value = '';
  }
});

$('#credentialsGrid').addEventListener('click', async e => {
  const copy = e.target.closest('[data-copy]');
  const reveal = e.target.closest('[data-reveal]');
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-delete]');
  if (copy) { const entry = state.entries.find(x => x.id === copy.dataset.id); copyText(entry[copy.dataset.copy], `${copy.dataset.copy === 'login' ? 'Login' : 'Senha'} copiado.`); }
  if (reveal) { state.reveal.has(reveal.dataset.reveal) ? state.reveal.delete(reveal.dataset.reveal) : state.reveal.add(reveal.dataset.reveal); render(); }
  if (edit) openModal(state.entries.find(x => x.id === edit.dataset.edit));
  if (del && confirm('Excluir esta credencial do cofre? Esta ação não pode ser desfeita.')) { state.entries = state.entries.filter(x => x.id !== del.dataset.delete); await persist(); render(); showToast('Acesso excluído.'); }
});

let draggedCardId = null;
$('#credentialsGrid').addEventListener('dragstart', e => {
  const card = e.target.closest('.credential-card');
  if (!card) return;
  draggedCardId = card.dataset.cardId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedCardId);
  requestAnimationFrame(() => card.classList.add('dragging'));
});
$('#credentialsGrid').addEventListener('dragover', e => {
  const card = e.target.closest('.credential-card');
  if (!card || card.dataset.cardId === draggedCardId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.credential-card.drag-over').forEach(item => item.classList.remove('drag-over'));
  card.classList.add('drag-over');
});
$('#credentialsGrid').addEventListener('drop', async e => {
  const target = e.target.closest('.credential-card');
  if (!target || !draggedCardId || target.dataset.cardId === draggedCardId) return;
  e.preventDefault();
  const rect = target.getBoundingClientRect();
  const placeAfter = e.clientY > rect.top + rect.height / 2 || e.clientX > rect.left + rect.width / 2;
  state.entries = moveEntry(state.entries, draggedCardId, target.dataset.cardId, placeAfter);
  draggedCardId = null;
  await persist(); render(); showToast('Card movido.');
});
$('#credentialsGrid').addEventListener('dragend', () => {
  draggedCardId = null;
  document.querySelectorAll('.credential-card.dragging, .credential-card.drag-over').forEach(item => item.classList.remove('dragging', 'drag-over'));
});

$('#searchInput').addEventListener('input', e => { state.query = e.target.value; render(); });
$('#newEntryBtn').addEventListener('click', () => openModal());
$('#emptyAddBtn').addEventListener('click', () => openModal());
$('#closeModal').addEventListener('click', closeModal);
$('#cancelModal').addEventListener('click', closeModal);
$('#entryModal').addEventListener('click', e => { if (e.target === $('#entryModal')) closeModal(); });
$('#toggleFormPassword').addEventListener('click', () => {
  const input=$('#entryPassword');
  const willShow=input.type==='password';
  input.type=willShow?'text':'password';
  $('#toggleFormPassword').innerHTML=eyeIcon(willShow);
  $('#toggleFormPassword').title=willShow?'Ocultar senha':'Mostrar senha';
  $('#toggleFormPassword').setAttribute('aria-label', $('#toggleFormPassword').title);
});
$('#toggleMasterPassword').addEventListener('click', () => {
  const input = $('#masterPassword');
  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  $('#toggleMasterPassword').innerHTML = eyeIcon(willShow);
  $('#toggleMasterPassword').title = willShow ? 'Ocultar chave mestra' : 'Mostrar chave mestra';
  $('#toggleMasterPassword').setAttribute('aria-label', $('#toggleMasterPassword').title);
});
$('#toggleSetupPassword').addEventListener('click', () => {
  const input = $('#masterSetupPassword');
  setPasswordVisibility('#masterSetupPassword', '#toggleSetupPassword', input.type === 'password');
});
$('#toggleMasterConfirm').addEventListener('click', () => {
  const input = $('#masterConfirm');
  setPasswordVisibility('#masterConfirm', '#toggleMasterConfirm', input.type === 'password');
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); if ($('#exportModal')) closeExportModal(); if ($('#resetVaultModal')) closeResetVaultModal(); } });
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('#menuBtn').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#sidebarToggle').addEventListener('click', () => {
  toggleSidebar($('.app-shell'), $('#sidebarToggle'));
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const light = theme === 'light';
  $('#themeIcon').textContent = light ? '☾' : '☀';
  $('#themeLabel').textContent = light ? 'Tema escuro' : 'Tema claro';
  $('#themeToggle').setAttribute('aria-label', light ? 'Ativar tema escuro' : 'Ativar tema claro');
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
if (localStorage.getItem('passman_sidebar_collapsed') === 'true') {
  $('.app-shell').classList.add('sidebar-collapsed');
  $('#sidebarToggle').setAttribute('aria-expanded', 'false');
  $('#sidebarToggle').setAttribute('aria-label', 'Expandir menu');
}
$('#themeToggle').addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
});

$('#lengthRange').addEventListener('input', e => { $('#lengthOutput').textContent = `${e.target.value} caracteres`; generatePassword(); });
document.querySelectorAll('.check-row input').forEach(input => input.addEventListener('change', generatePassword));
$('#generateBtn').addEventListener('click', generatePassword);
$('#copyGenerated').addEventListener('click', () => copyText($('#generatedPassword').textContent, 'Senha gerada copiada.'));
$('#usePasswordBtn').addEventListener('click', () => { const password=$('#generatedPassword').textContent; switchView('vault'); openModal(); $('#entryPassword').value=password; });
$('#openGeneratorBtn').addEventListener('click', () => { closeModal(); switchView('generator'); });

async function obsoleteExport() {
  const envelope = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
  if (!envelope || !activeVaultKey) return showToast('Desbloqueie o cofre antes de exportar.', true);
  const payload = { ...envelope, exportedAt:new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
  const link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`passman-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); URL.revokeObjectURL(link.href);
  showToast('Backup criptografado exportado.');
}
function renderExportCards() {
  const container = $('#exportCards');
  container.innerHTML = '';
  state.entries.forEach(entry => {
    const label = document.createElement('label');
    label.className = 'export-card-option';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'exportCard'; input.value = entry.id;
    const title = document.createElement('span');
    title.textContent = entry.title + ' · ' + entry.login;
    label.append(input, title); container.appendChild(label);
  });
}
function openExportModal() {
  if (!activeVaultKey) return showToast('Desbloqueie o cofre antes de exportar.', true);
  if (!state.entries.length) return showToast('Não há cards para exportar.', true);
  $('#exportForm').reset(); $('#exportSelection').hidden = true; renderExportCards();
  $('#exportModal').classList.add('open'); $('#exportModal').setAttribute('aria-hidden', 'false');
}
function closeExportModal() {
  $('#exportModal').classList.remove('open'); $('#exportModal').setAttribute('aria-hidden', 'true');
}
$('#exportBtn').addEventListener('click', openExportModal);
$('#closeExportModal').addEventListener('click', closeExportModal);
$('#cancelExportModal').addEventListener('click', closeExportModal);
$('#exportModal').addEventListener('click', e => { if (e.target === $('#exportModal')) closeExportModal(); });
document.querySelectorAll('input[name="exportScope"]').forEach(input => input.addEventListener('change', e => {
  $('#exportSelection').hidden = e.target.value !== 'selected';
}));
$('#selectAllExport').addEventListener('click', () => {
  const boxes = [...document.querySelectorAll('input[name="exportCard"]')];
  const mark = boxes.some(box => !box.checked);
  boxes.forEach(box => box.checked = mark);
  $('#selectAllExport').textContent = mark ? 'Desmarcar todos' : 'Marcar todos';
});
$('#exportForm').addEventListener('submit', async e => {
  e.preventDefault();
  const password = $('#backupPassword').value;
  const confirmation = $('#backupPasswordConfirm').value;
  const formData = new FormData(e.target);
  const scope = formData.get('exportScope');
  let entries = state.entries;
  if (password.length < 12) return showToast('A chave do backup deve ter pelo menos 12 caracteres.', true);
  if (password !== confirmation) return showToast('A confirmação da chave do backup não coincide.', true);
  if (scope === 'selected') {
    const selected = new Set(formData.getAll('exportCard'));
    entries = state.entries.filter(entry => selected.has(entry.id));
    if (!entries.length) return showToast('Selecione ao menos um card para exportar.', true);
  }
  const button = $('#confirmExportBtn'); button.disabled = true;
  try {
    const backupSalt = crypto.getRandomValues(new Uint8Array(16));
    const backupKey = await deriveEncryptionKey(password, backupSalt);
    const envelope = await encryptEntries(entries, backupKey, backupSalt);
    const validation = await decryptEnvelope(envelope, password);
    if (JSON.stringify(validation.entries) !== JSON.stringify(entries)) throw new Error('Falha na validação do backup.');
    envelope.exportedAt = new Date().toISOString();
    envelope.scope = scope === 'full' ? 'full' : 'selected';
    envelope.itemCount = entries.length;
    const blob = new Blob([JSON.stringify(envelope,null,2)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'passman-backup-' + new Date().toISOString().slice(0,10) + '.json';
    link.click(); URL.revokeObjectURL(link.href);
    closeExportModal();
    showToast(entries.length + ' card(s) exportado(s) com chave exclusiva.');
  } catch {
    showToast('Não foi possível criar o backup criptografado.', true);
  } finally { button.disabled = false; }
});

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file=e.target.files[0]; if(!file) return;
  try {
    const envelope = JSON.parse(await file.text());
    const backupPassword = prompt('Informe a chave mestra usada para criptografar este backup:');
    if (backupPassword === null) throw new Error('Importação cancelada.');
    const unlocked = await decryptEnvelope(envelope, backupPassword);
    state.entries = unlocked.entries.filter(x=>x&&typeof x.title==='string'&&typeof x.login==='string'&&typeof x.password==='string').map(x=>({...x,id:x.id||crypto.randomUUID(),updatedAt:x.updatedAt||new Date().toISOString()}));
    await persist(); render(); showToast(`${state.entries.length} acessos descriptografados e importados.`);
  } catch (error) {
    showToast(error.message === 'Importação cancelada.' ? error.message : 'Backup inválido, adulterado ou chave incorreta.', true);
  }
  e.target.value='';
});

function updateClock() { const now=new Date(); $('#clock').textContent=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); $('#currentDate').textContent=now.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}).toUpperCase(); }
updateClock(); setInterval(updateClock,1000); render(); generatePassword(); checkSession(); setInterval(checkSession,30000);
