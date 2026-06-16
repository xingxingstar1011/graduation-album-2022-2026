
const STORE_COPY = 'graduationAlbum.copyOverrides.v1';
const STORE_INSERTS = 'graduationAlbum.customInserts.v1';
const STORE_US_ADDS = 'graduationAlbum.usAdds.v1';
const STORE_US_REMOVES = 'graduationAlbum.usRemoves.v1';
const STORE_PHOTO_DATES = 'graduationAlbum.photoDateOverrides.v1';
const STORE_MONTHS = 'graduationAlbum.monthAdjustments.v1';

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || ''); } catch { return fallback; }
}
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function downloadJSON(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function normalizeMonthAdjustments(value) {
  return {
    hidden: value?.hidden && typeof value.hidden === 'object' ? value.hidden : {},
    custom: Array.isArray(value?.custom) ? value.custom : []
  };
}

let copyOverrides = readJSON(STORE_COPY, {});
let customInserts = readJSON(STORE_INSERTS, []);
let usAdds = readJSON(STORE_US_ADDS, {});
let usRemoves = readJSON(STORE_US_REMOVES, {});
let photoDateOverrides = readJSON(STORE_PHOTO_DATES, {});
let monthAdjustments = normalizeMonthAdjustments(readJSON(STORE_MONTHS, {}));
let editingCopy = false;

const syncConfig = window.ALBUM_SYNC_CONFIG || {};
let syncClient = null;
let syncUser = null;
let syncSaveTimer = null;

function syncSetStatus(message) {
  const node = document.getElementById('sync-status');
  if (node) node.textContent = message;
}

function getAlbumState() {
  return {
    copyOverrides,
    customInserts,
    usAdds,
    usRemoves,
    photoDateOverrides,
    monthAdjustments,
    savedAt: new Date().toISOString()
  };
}

function persistAlbumState() {
  writeJSON(STORE_COPY, copyOverrides);
  writeJSON(STORE_INSERTS, customInserts);
  writeJSON(STORE_US_ADDS, usAdds);
  writeJSON(STORE_US_REMOVES, usRemoves);
  writeJSON(STORE_PHOTO_DATES, photoDateOverrides);
  writeJSON(STORE_MONTHS, monthAdjustments);
}

function applyAlbumState(state) {
  copyOverrides = state?.copyOverrides || {};
  customInserts = state?.customInserts || [];
  usAdds = state?.usAdds || {};
  usRemoves = state?.usRemoves || {};
  photoDateOverrides = state?.photoDateOverrides || {};
  monthAdjustments = normalizeMonthAdjustments(state?.monthAdjustments);
  persistAlbumState();
  applyMonthAdjustments();
  applyCopyOverrides();
  applyPhotoDateOverrides();
  renderUsGrid();
  renderCustomInserts();
}

function queueCloudSave() {
  if (!syncClient || !syncUser) return;
  clearTimeout(syncSaveTimer);
  syncSaveTimer = setTimeout(() => { saveCloudState().catch((error) => syncSetStatus(`云端保存失败：${error.message}`)); }, 900);
}


function applyCopyOverrides() {
  document.querySelectorAll('[data-copy-id]').forEach((node) => {
    bindCopyNode(node);
    const id = node.dataset.copyId;
    if (copyOverrides[id] !== undefined) node.innerHTML = copyOverrides[id];
    node.contentEditable = editingCopy ? 'true' : 'false';
    node.classList.toggle('editing-copy', editingCopy);
  });
}

function bindCopyNode(node) {
  if (node.dataset.copyBound === '1') return;
  node.dataset.copyBound = '1';
  node.addEventListener('blur', () => {
    if (!editingCopy) return;
    copyOverrides[node.dataset.copyId] = node.innerHTML;
    writeJSON(STORE_COPY, copyOverrides);
    queueCloudSave();
  });
}

const originalCards = Array.from(document.querySelectorAll('.month-spread .photo-card'));
const staticUsCards = Array.from(document.querySelectorAll('#us-grid .photo-card.us-static'));
const lightbox = document.querySelector('.lightbox');
const lightboxImg = lightbox.querySelector('img');
const lightboxCaption = lightbox.querySelector('figcaption');
const closeBtn = lightbox.querySelector('.lightbox-close');
const prevBtn = lightbox.querySelector('.lightbox-prev');
const nextBtn = lightbox.querySelector('.lightbox-next');
const usToggle = document.getElementById('us-toggle');
const photoDateInput = document.getElementById('photo-date-value');
const photoDateSave = document.getElementById('photo-date-save');
const photoDateReset = document.getElementById('photo-date-reset');
const monthYearSelect = document.getElementById('month-year');
const monthTitleInput = document.getElementById('month-title');
const monthAddBtn = document.getElementById('month-add');
const monthManageSelect = document.getElementById('month-manage-target');
const monthToggleBtn = document.getElementById('month-toggle');
let currentIndex = 0;
let currentCard = null;

document.querySelectorAll('.photo-card[data-photo-id]').forEach((card) => {
  if (!card.dataset.originalCaption) {
    card.dataset.originalCaption = card.dataset.caption || card.querySelector('.photo-caption')?.textContent || '';
  }
});

function setPhotoCardCaption(card, caption) {
  card.dataset.caption = caption;
  const label = card.querySelector('.photo-caption');
  if (label) label.textContent = caption;
  const img = card.querySelector('img');
  if (img) img.alt = caption;
  card.setAttribute('aria-label', `查看照片 ${caption}`);
}

function applyPhotoDateOverrides(root = document) {
  const cards = root.matches?.('.photo-card[data-photo-id]')
    ? [root, ...root.querySelectorAll('.photo-card[data-photo-id]')]
    : Array.from(root.querySelectorAll('.photo-card[data-photo-id]'));
  cards.forEach((card) => {
    if (!card.dataset.originalCaption) {
      card.dataset.originalCaption = card.dataset.caption || card.querySelector('.photo-caption')?.textContent || '';
    }
    const id = card.dataset.photoId;
    const caption = photoDateOverrides[id] || card.dataset.originalCaption || '';
    setPhotoCardCaption(card, caption);
  });
}

function updatePhotoDateControls() {
  if (!photoDateInput) return;
  const hasPhoto = !!currentCard?.dataset?.photoId;
  photoDateInput.disabled = !hasPhoto;
  if (photoDateSave) photoDateSave.disabled = !hasPhoto;
  if (photoDateReset) photoDateReset.disabled = !hasPhoto;
  photoDateInput.value = hasPhoto ? (currentCard.dataset.caption || '') : '';
  photoDateInput.placeholder = hasPhoto ? '修改这张照片的日期' : '先点开一张照片';
}

function saveCurrentPhotoDate() {
  if (!currentCard?.dataset?.photoId || !photoDateInput) {
    syncSetStatus('先点开一张照片，再修改日期');
    return;
  }
  const id = currentCard.dataset.photoId;
  const value = photoDateInput.value.trim();
  if (value) photoDateOverrides[id] = value;
  else delete photoDateOverrides[id];
  writeJSON(STORE_PHOTO_DATES, photoDateOverrides);
  applyPhotoDateOverrides();
  renderUsGrid();
  renderCustomInserts();
  openLightboxByCard(currentCard);
  queueCloudSave();
  syncSetStatus('照片日期已保存');
}

function resetCurrentPhotoDate() {
  if (!currentCard?.dataset?.photoId) {
    syncSetStatus('先点开一张照片，再还原日期');
    return;
  }
  delete photoDateOverrides[currentCard.dataset.photoId];
  writeJSON(STORE_PHOTO_DATES, photoDateOverrides);
  applyPhotoDateOverrides();
  renderUsGrid();
  renderCustomInserts();
  openLightboxByCard(currentCard);
  queueCloudSave();
  syncSetStatus('照片日期已还原');
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function sectionIdFromTarget(target) {
  return target?.startsWith('insert-') ? `section-${target.slice(7)}` : target;
}

function monthTargetFromArticle(article) {
  return article.querySelector('[data-insert-target]')?.dataset.insertTarget || article.id.replace(/^section-/, 'insert-');
}

function monthLabelFromArticle(article) {
  const layout = article.querySelector('[data-insert-target]');
  const heading = article.querySelector('.month-meta h3')?.textContent?.trim();
  return layout?.dataset.insertLabel || heading || article.id.replace(/^section-/, '');
}

function renderCustomMonths() {
  document.querySelectorAll('.month-spread.custom-month').forEach((node) => node.remove());
  document.querySelectorAll('.month-index a[data-custom-month="1"]').forEach((node) => node.remove());
  document.querySelectorAll('#insert-target option[data-custom-month="1"]').forEach((node) => node.remove());

  monthAdjustments.custom.forEach((item) => {
    if (!item?.id || !item.year) return;
    const yearSection = document.getElementById(`year-${item.year}`);
    if (!yearSection) return;
    const sectionId = `section-${item.id}`;
    const target = `insert-${item.id}`;
    const title = item.title || '新增月份';
    const label = `${item.year} / ${title}`;

    const nav = yearSection.querySelector('.month-index');
    if (nav) {
      const link = document.createElement('a');
      link.href = `#${sectionId}`;
      link.dataset.customMonth = '1';
      link.textContent = title;
      nav.appendChild(link);
    }

    const article = document.createElement('article');
    article.className = 'month-spread custom-month';
    article.id = sectionId;
    article.innerHTML = `
      <div class="month-meta">
        <p class="eyebrow" data-copy-id="${item.id}.eyebrow">${item.year} / Added Month</p>
        <h3 data-copy-id="${item.id}.title">${escapeHTML(title)}</h3>
        <p data-copy-id="${item.id}.desc">新增的月份，可以继续插入照片和编辑文案。</p>
        <span>0 frames</span>
      </div>
      <div class="photo-layout layout-dense" data-insert-target="${target}" data-insert-label="${escapeHTML(label)}"></div>
    `;
    yearSection.appendChild(article);

    const insertTarget = document.getElementById('insert-target');
    if (insertTarget) {
      const option = document.createElement('option');
      option.value = target;
      option.textContent = label;
      option.dataset.customMonth = '1';
      insertTarget.appendChild(option);
    }
  });
}

function populateMonthControls() {
  if (!monthManageSelect) return;
  const previous = monthManageSelect.value;
  monthManageSelect.innerHTML = '';
  document.querySelectorAll('.month-spread').forEach((article) => {
    const target = monthTargetFromArticle(article);
    const option = document.createElement('option');
    option.value = target;
    option.textContent = monthAdjustments.hidden[target] ? `${monthLabelFromArticle(article)}（已删除）` : monthLabelFromArticle(article);
    monthManageSelect.appendChild(option);
  });
  if (previous && Array.from(monthManageSelect.options).some((option) => option.value === previous)) {
    monthManageSelect.value = previous;
  }
  updateMonthToggleLabel();
}

function updateMonthToggleLabel() {
  if (!monthToggleBtn || !monthManageSelect) return;
  monthToggleBtn.textContent = monthAdjustments.hidden[monthManageSelect.value] ? '恢复月份' : '删除月份';
}

function applyMonthAdjustments() {
  monthAdjustments = normalizeMonthAdjustments(monthAdjustments);
  renderCustomMonths();
  document.querySelectorAll('.month-spread').forEach((article) => {
    const target = monthTargetFromArticle(article);
    const hidden = !!monthAdjustments.hidden[target];
    article.hidden = hidden;
    article.classList.toggle('month-hidden', hidden);
    document.querySelectorAll(`.month-index a[href="#${CSS.escape(article.id)}"]`).forEach((link) => {
      link.hidden = hidden;
    });
  });
  populateMonthControls();
  applyCopyOverrides();
}

function addCustomMonth() {
  const year = monthYearSelect?.value;
  const title = monthTitleInput?.value.trim();
  if (!year || !title) {
    syncSetStatus('请选择年份并填写月份名称');
    return;
  }
  const id = `custom-${year}-${Date.now()}`;
  monthAdjustments.custom.push({ id, year, title, createdAt: new Date().toISOString() });
  writeJSON(STORE_MONTHS, monthAdjustments);
  applyMonthAdjustments();
  renderCustomInserts();
  if (monthManageSelect) monthManageSelect.value = `insert-${id}`;
  if (document.getElementById('insert-target')) document.getElementById('insert-target').value = `insert-${id}`;
  if (monthTitleInput) monthTitleInput.value = '';
  queueCloudSave();
  syncSetStatus('月份已新增');
}

function toggleSelectedMonth() {
  const target = monthManageSelect?.value;
  if (!target) {
    syncSetStatus('请选择要删除或恢复的月份');
    return;
  }
  if (monthAdjustments.hidden[target]) {
    delete monthAdjustments.hidden[target];
    syncSetStatus('月份已恢复');
  } else {
    monthAdjustments.hidden[target] = true;
    syncSetStatus('月份已删除');
  }
  writeJSON(STORE_MONTHS, monthAdjustments);
  applyMonthAdjustments();
  queueCloudSave();
}

function isInUs(card) {
  const id = card.dataset.photoId;
  if (!id) return false;
  if (usRemoves[id]) return false;
  return card.dataset.usCandidate === '1' || !!usAdds[id];
}

function setUsState(card, value) {
  const id = card.dataset.photoId;
  if (!id) return;
  if (value) {
    usAdds[id] = true;
    delete usRemoves[id];
  } else {
    delete usAdds[id];
    usRemoves[id] = true;
  }
  writeJSON(STORE_US_ADDS, usAdds);
  writeJSON(STORE_US_REMOVES, usRemoves);
  queueCloudSave();
  renderUsGrid();
  renderCustomInserts();
  updateUsToggle();
}

function updateUsToggle() {
  usToggle.style.display = 'none';
}

function openLightboxByCard(card) {
  currentCard = card;
  const index = originalCards.findIndex((item) => item.dataset.photoId === card.dataset.photoId);
  currentIndex = index >= 0 ? index : currentIndex;
  lightboxImg.src = card.dataset.full;
  lightboxImg.alt = card.dataset.caption || '';
  lightboxCaption.textContent = card.dataset.caption || '';
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  updateUsToggle();
  updatePhotoDateControls();
}

function openLightbox(index) {
  if (!originalCards.length) return;
  currentIndex = index;
  openLightboxByCard(originalCards[currentIndex]);
}

function closeLightbox() {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImg.src = '';
  document.body.style.overflow = '';
  updatePhotoDateControls();
}

function step(delta) {
  if (!originalCards.length) return;
  currentIndex = (currentIndex + delta + originalCards.length) % originalCards.length;
  openLightbox(currentIndex);
}

originalCards.forEach((card, index) => {
  card.addEventListener('click', () => openLightbox(index));
});
closeBtn.addEventListener('click', closeLightbox);
prevBtn.addEventListener('click', () => step(-1));
nextBtn.addEventListener('click', () => step(1));
usToggle.addEventListener('click', () => {
  if (currentCard) setUsState(currentCard, !isInUs(currentCard));
});
photoDateSave?.addEventListener('click', saveCurrentPhotoDate);
photoDateReset?.addEventListener('click', resetCurrentPhotoDate);
photoDateInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveCurrentPhotoDate();
});
monthAddBtn?.addEventListener('click', addCustomMonth);
monthToggleBtn?.addEventListener('click', toggleSelectedMonth);
monthManageSelect?.addEventListener('change', updateMonthToggleLabel);
lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (event) => {
  if (!lightbox.classList.contains('open')) return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') step(-1);
  if (event.key === 'ArrowRight') step(1);
});

function updateUsCount() {
  const count = document.getElementById('us-count');
  const grid = document.getElementById('us-grid');
  if (count && grid) count.textContent = `${grid.querySelectorAll('.photo-card').length} photos`;
}

function renderUsGrid() {
  const grid = document.getElementById('us-grid');
  if (!grid) return;
  grid.innerHTML = '';
  staticUsCards.forEach((card) => {
    const clone = card.cloneNode(true);
    clone.addEventListener('click', () => openLightboxByCard(clone));
    grid.appendChild(clone);
  });
  updateUsCount();
}
renderUsGrid();

const player = document.querySelector('.music-player');
const tracks = player ? JSON.parse(player.dataset.tracks || '[]') : [];
const audio = document.getElementById('bgm-audio');
const trackTitle = document.getElementById('track-title');
const playBtn = document.getElementById('track-play');
const prevTrackBtn = document.getElementById('track-prev');
const nextTrackBtn = document.getElementById('track-next');
const muteBtn = document.getElementById('track-mute');
const volume = document.getElementById('track-volume');
const defaultTrackIndex = Math.max(0, tracks.findIndex((track) => track.title?.toLowerCase() === 'yellow' || track.src?.includes('track-02')));
let trackIndex = 0;
let pendingAutoplay = false;
let userPausedAudio = false;

function requestAudioPlay() {
  if (!audio || !tracks.length) return;
  userPausedAudio = false;
  audio.play()
    .then(() => { pendingAutoplay = false; })
    .catch(() => {
      pendingAutoplay = true;
      if (playBtn) playBtn.textContent = 'Play';
    });
}

function loadTrack(index, shouldPlay = false) {
  if (!tracks.length) return;
  trackIndex = (index + tracks.length) % tracks.length;
  const track = tracks[trackIndex];
  audio.src = track.src;
  trackTitle.textContent = `${track.title} - ${track.artist}`;
  if (shouldPlay) requestAudioPlay();
  playBtn.textContent = audio.paused ? 'Play' : 'Pause';
}
if (tracks.length) {
  audio.volume = Number(volume.value);
  pendingAutoplay = true;
  loadTrack(defaultTrackIndex, true);
}
playBtn?.addEventListener('click', () => {
  if (!tracks.length) return;
  if (audio.paused) requestAudioPlay();
  else {
    pendingAutoplay = false;
    userPausedAudio = true;
    audio.pause();
  }
});
function resumePendingAutoplay() {
  if (pendingAutoplay && !userPausedAudio && audio?.paused) requestAudioPlay();
}
document.addEventListener('pointerdown', resumePendingAutoplay, { capture: true });
document.addEventListener('touchstart', resumePendingAutoplay, { capture: true });
document.addEventListener('keydown', resumePendingAutoplay, { capture: true });
audio?.addEventListener('play', () => { playBtn.textContent = 'Pause'; });
audio?.addEventListener('pause', () => { playBtn.textContent = 'Play'; });
audio?.addEventListener('ended', () => loadTrack(trackIndex + 1, true));
prevTrackBtn?.addEventListener('click', () => loadTrack(trackIndex - 1, !audio.paused));
nextTrackBtn?.addEventListener('click', () => loadTrack(trackIndex + 1, !audio.paused));
muteBtn?.addEventListener('click', () => {
  audio.muted = !audio.muted;
  muteBtn.textContent = audio.muted ? 'Sound' : 'Mute';
});
volume?.addEventListener('input', () => {
  audio.volume = Number(volume.value);
  if (audio.volume > 0) audio.muted = false;
  muteBtn.textContent = audio.muted ? 'Sound' : 'Mute';
});

const copyToggle = document.getElementById('copy-toggle');
function setCopyEditing(enabled) {
  editingCopy = enabled;
  applyCopyOverrides();
  copyToggle.textContent = enabled ? '完成文案' : '文案';
}
copyToggle?.addEventListener('click', () => setCopyEditing(!editingCopy));
document.getElementById('copy-export')?.addEventListener('click', () => downloadJSON('album-copy.json', copyOverrides));
document.getElementById('copy-import')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  copyOverrides = JSON.parse(await file.text());
  writeJSON(STORE_COPY, copyOverrides);
  applyCopyOverrides();
});

function imageFileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxEdge = 1600;
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function dataURLToBlob(dataURL) {
  const [meta, data] = dataURL.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'image/jpeg';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function safeUploadName(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'image.jpg';
}

async function imageFileForInsert(file) {
  const dataURL = await imageFileToDataURL(file);
  if (!syncClient || !syncUser || !syncConfig.storageBucket) return dataURL;
  const path = `${syncConfig.albumId || 'album'}/${Date.now()}-${safeUploadName(file.name).replace(/\.[^.]+$/, '')}.jpg`;
  const blob = dataURLToBlob(dataURL);
  const { error } = await syncClient.storage.from(syncConfig.storageBucket).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    syncSetStatus(`图片上传失败，已保存到本机：${error.message}`);
    return dataURL;
  }
  const { data } = syncClient.storage.from(syncConfig.storageBucket).getPublicUrl(path);
  syncSetStatus('图片已上传云端');
  return data.publicUrl || dataURL;
}

function renderCustomInserts() {
  document.querySelectorAll('.photo-card.custom').forEach((node) => node.remove());
  customInserts.forEach((item) => {
    const target = document.querySelector(`[data-insert-target="${CSS.escape(item.target)}"]`);
    if (!target) return;
    const isUsTarget = item.target === 'insert-us';
    const fallbackCaption = isUsTarget ? '\u6211\u4eec' : '\u65b0\u56fe\u7247';
    const caption = item.caption || fallbackCaption;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'photo-card portrait custom';
    card.dataset.photoId = item.id;
    card.dataset.full = item.src;
    card.dataset.thumb = item.src;
    card.dataset.caption = caption;
    card.dataset.originalCaption = caption;
    card.innerHTML = `<img src="${item.src}" alt="${caption}" loading="lazy" decoding="async">${isUsTarget ? '' : `<span class="photo-caption">${caption}</span>`}`;
    applyPhotoDateOverrides(card);
    card.addEventListener('click', () => openLightboxByCard(card));
    if (item.position === 'start') target.prepend(card);
    else target.appendChild(card);
  });
  updateUsCount();
}
renderCustomInserts();

document.getElementById('insert-file')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const target = document.getElementById('insert-target').value;
  const position = document.getElementById('insert-position').value;
  const caption = document.getElementById('insert-caption').value.trim() || (target === 'insert-us' ? '\u6211\u4eec' : '');
  const src = await imageFileForInsert(file);
  customInserts.push({ id: `custom-${Date.now()}`, target, position, caption, src });
  writeJSON(STORE_INSERTS, customInserts);
  queueCloudSave();
  renderCustomInserts();
  updateUsCount();
  event.target.value = '';
});


document.getElementById('us-add-file')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const src = await imageFileForInsert(file);
  customInserts.push({ id: `custom-us-${Date.now()}`, target: 'insert-us', position: 'end', caption: '\u6211\u4eec', src });
  writeJSON(STORE_INSERTS, customInserts);
  queueCloudSave();
  renderCustomInserts();
  updateUsCount();
  event.target.value = '';
});

document.getElementById('state-export')?.addEventListener('click', () => {
  downloadJSON('album-adjustments.json', { copyOverrides, customInserts, usAdds, usRemoves, photoDateOverrides, monthAdjustments });
});
document.getElementById('state-import')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const state = JSON.parse(await file.text());
  copyOverrides = state.copyOverrides || {};
  customInserts = state.customInserts || [];
  usAdds = state.usAdds || {};
  usRemoves = state.usRemoves || {};
  photoDateOverrides = state.photoDateOverrides || {};
  monthAdjustments = normalizeMonthAdjustments(state.monthAdjustments);
  writeJSON(STORE_COPY, copyOverrides);
  writeJSON(STORE_INSERTS, customInserts);
  writeJSON(STORE_US_ADDS, usAdds);
  writeJSON(STORE_US_REMOVES, usRemoves);
  writeJSON(STORE_PHOTO_DATES, photoDateOverrides);
  writeJSON(STORE_MONTHS, monthAdjustments);
  applyMonthAdjustments();
  applyCopyOverrides();
  applyPhotoDateOverrides();
  renderUsGrid();
  renderCustomInserts();
  queueCloudSave();
});

applyMonthAdjustments();
applyCopyOverrides();
applyPhotoDateOverrides();
renderUsGrid();
renderCustomInserts();
updatePhotoDateControls();

async function initCloudSync() {
  if (!syncConfig.enabled) {
    syncSetStatus('云同步未配置：填写 assets/sync-config.js 后启用');
    return;
  }
  if (!window.supabase || !syncConfig.supabaseUrl || !syncConfig.anonKey) {
    syncSetStatus('云同步缺少 Supabase SDK / URL / anon key');
    return;
  }
  syncClient = window.supabase.createClient(syncConfig.supabaseUrl, syncConfig.anonKey);
  const { data } = await syncClient.auth.getSession();
  syncUser = data.session?.user || null;
  syncSetStatus(syncUser ? `已登录：${syncUser.email}` : '云同步已连接，未登录');
  syncClient.auth.onAuthStateChange((_event, session) => {
    syncUser = session?.user || null;
    syncSetStatus(syncUser ? `已登录：${syncUser.email}` : '云同步已连接，未登录');
  });
  if (syncConfig.autoLoad !== false) {
    await loadCloudState().catch((error) => syncSetStatus(`读取云端失败：${error.message}`));
  }
}

async function signInCloud() {
  if (!syncClient) return syncSetStatus('云同步未配置');
  const email = document.getElementById('sync-email')?.value.trim();
  const password = document.getElementById('sync-password')?.value;
  if (!email || !password) return syncSetStatus('请输入 Supabase 邮箱和密码');
  const { data, error } = await syncClient.auth.signInWithPassword({ email, password });
  if (error) return syncSetStatus(`登录失败：${error.message}`);
  syncUser = data.user;
  syncSetStatus(`已登录：${syncUser.email}`);
  await loadCloudState().catch((loadError) => syncSetStatus(`读取云端失败：${loadError.message}`));
}

async function signOutCloud() {
  if (!syncClient) return;
  await syncClient.auth.signOut();
  syncUser = null;
  syncSetStatus('已退出云同步');
}

async function loadCloudState() {
  if (!syncClient) return syncSetStatus('云同步未配置');
  const table = syncConfig.stateTable || 'album_states';
  const albumId = syncConfig.albumId || 'graduation-album';
  const { data, error } = await syncClient.from(table).select('state,updated_at').eq('album_id', albumId).maybeSingle();
  if (error) throw error;
  if (!data?.state) return syncSetStatus('云端还没有保存过调整');
  applyAlbumState(data.state);
  syncSetStatus(`已读取云端：${data.updated_at || ''}`);
}

async function saveCloudState() {
  if (!syncClient) return syncSetStatus('云同步未配置');
  if (!syncUser) return syncSetStatus('请先登录，再保存到云端');
  const table = syncConfig.stateTable || 'album_states';
  const albumId = syncConfig.albumId || 'graduation-album';
  const payload = { album_id: albumId, state: getAlbumState(), updated_at: new Date().toISOString() };
  const { error } = await syncClient.from(table).upsert(payload, { onConflict: 'album_id' });
  if (error) throw error;
  syncSetStatus('已保存到云端，其他设备刷新后可同步');
}

document.getElementById('sync-login')?.addEventListener('click', () => signInCloud().catch((error) => syncSetStatus(`登录失败：${error.message}`)));
document.getElementById('sync-logout')?.addEventListener('click', () => signOutCloud().catch((error) => syncSetStatus(`退出失败：${error.message}`)));
document.getElementById('sync-load')?.addEventListener('click', () => loadCloudState().catch((error) => syncSetStatus(`读取云端失败：${error.message}`)));
document.getElementById('sync-save')?.addEventListener('click', () => saveCloudState().catch((error) => syncSetStatus(`保存云端失败：${error.message}`)));
initCloudSync().catch((error) => syncSetStatus(`云同步初始化失败：${error.message}`));
