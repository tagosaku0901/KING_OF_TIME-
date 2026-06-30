/**
 * KingOfTime Quick Input - Content Script
 *
 * 月次一覧画面のテーブルにインライン入力フィールドを追加し、
 * 一括登録ボタンで全日付の勤怠をまとめて登録する。
 *
 * 動作フロー（1日分の登録）:
 * 1. 対象行のhiddenフィールド + action_id=2 → fetch POST → 編集画面HTML取得
 * 2. 編集画面HTMLからフォーム情報（CSRFトークン等）を抽出
 * 3. 編集フォームデータ + 出勤退勤時刻 + action_id=1 → fetch POST → 登録完了
 */

(function () {
  'use strict';

  // ==========================================================================
  // 設定
  // ==========================================================================
  const CONFIG = {
    tableContainerSelector: '.htBlock-adjastableTableF_inner',
    dateCellIndex: 1,
    startTimeCellIndex: 6,
    endTimeCellIndex: 7,
    requestDelay: 1000,
  };

  // ==========================================================================
  // メイン処理
  // ==========================================================================

  let isInitialized = false;
  let bulkButton = null;

  /**
   * 月次一覧画面を検知して初期化
   */
  function init() {
    if (isInitialized) return;

    const container = document.querySelector(CONFIG.tableContainerSelector);
    if (!container) return;

    const table = container.querySelector('table');
    if (!table) return;

    if (table.rows.length < 28) return;

    console.log('[KOT Quick Input] 月次一覧テーブルを検出しました');
    isInitialized = true;
    injectInputFields(table);
    injectBulkSubmitButton();
  }

  /**
   * テーブルの各行に入力フィールドを追加
   */
  function injectInputFields(table) {
    const allRows = table.rows;
    for (let i = 1; i < allRows.length; i++) {
      processRow(allRows[i]);
    }
  }

  /**
   * 1行分の処理
   */
  function processRow(row) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 8) return;

    const dateCell = cells[CONFIG.dateCellIndex];
    if (!dateCell) return;

    const dateInfo = parseDateFromCell(dateCell);
    if (!dateInfo) return;

    // 行からhiddenフィールドのデータを収集して保持
    const rowData = collectRowHiddenData(row, dateInfo.dayPadded);

    // 出勤時刻の入力フィールドを追加
    const startCell = cells[CONFIG.startTimeCellIndex];
    if (startCell) {
      const existingTime = extractTimeFromCell(startCell);
      injectTimeInput(startCell, 'start', dateInfo.dateYYYYMMDD, dateInfo.dayPadded, existingTime, rowData);
    }

    // 退勤時刻の入力フィールドを追加
    const endCell = cells[CONFIG.endTimeCellIndex];
    if (endCell) {
      const existingTime = extractTimeFromCell(endCell);
      injectTimeInput(endCell, 'end', dateInfo.dateYYYYMMDD, dateInfo.dayPadded, existingTime, rowData);
    }
  }

  /**
   * 行のhiddenフィールドから送信に必要なデータを収集
   * 重複があるので最初の1セットだけ取る
   */
  function collectRowHiddenData(row, dayPadded) {
    const data = {};
    const hiddens = row.querySelectorAll('input[type="hidden"]');
    const seen = new Set();

    hiddens.forEach((h) => {
      if (!h.name || seen.has(h.name)) return;
      seen.add(h.name);
      data[h.name] = h.value;
    });

    return data;
  }

  /**
   * セルに時刻入力フィールドを注入
   */
  function injectTimeInput(cell, type, dateYYYYMMDD, dayPadded, existingTime, rowData) {
    const wrapper = document.createElement('div');
    wrapper.className = 'kot-input-cell';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'kot-time-input';
    input.placeholder = 'HH:MM';
    input.maxLength = 5;
    input.dataset.type = type;
    input.dataset.date = dateYYYYMMDD;
    input.dataset.day = dayPadded;
    input.dataset.originalValue = existingTime || '';
    // 行のhiddenデータをJSON化して保持
    input.dataset.rowData = JSON.stringify(rowData);

    if (existingTime) {
      input.value = existingTime;
    }

    // 入力フォーマットの補助
    input.addEventListener('input', (e) => {
      let val = e.target.value.replace(/[^0-9]/g, '');
      if (val.length >= 3) {
        val = val.slice(0, 2) + ':' + val.slice(2, 4);
      }
      e.target.value = val;

      if (val !== input.dataset.originalValue) {
        input.classList.add('kot-modified');
      } else {
        input.classList.remove('kot-modified');
      }
    });

    // Enterキーで次のフィールドへ
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const allInputs = document.querySelectorAll('.kot-time-input');
        const currentIdx = Array.from(allInputs).indexOf(input);
        if (currentIdx < allInputs.length - 1) {
          allInputs[currentIdx + 1].focus();
        }
      }
    });

    wrapper.appendChild(input);
    cell.innerHTML = '';
    cell.appendChild(wrapper);
  }

  /**
   * 一括登録ボタンを追加
   */
  function injectBulkSubmitButton() {
    if (bulkButton) return;

    bulkButton = document.createElement('button');
    bulkButton.className = 'kot-bulk-submit-btn';
    bulkButton.textContent = '一括登録';
    bulkButton.addEventListener('click', handleBulkSubmit);

    document.body.appendChild(bulkButton);
  }

  /**
   * 一括登録の実行
   */
  async function handleBulkSubmit() {
    const inputs = document.querySelectorAll('.kot-time-input.kot-modified');
    if (inputs.length === 0) {
      showStatus('変更された項目がありません', 'info');
      return;
    }

    // 日付ごとにデータを集約
    const dateMap = new Map();
    inputs.forEach((input) => {
      const date = input.dataset.date;
      const day = input.dataset.day;
      const type = input.dataset.type;
      const value = input.value;
      const rowData = JSON.parse(input.dataset.rowData);

      if (!dateMap.has(date)) {
        dateMap.set(date, { day, rowData, start: '', end: '' });
      }
      dateMap.get(date)[type] = value;
    });

    // バリデーション
    let hasError = false;
    dateMap.forEach((data, date) => {
      if (data.start && !isValidTime(data.start)) {
        hasError = true;
        markInputError(date, 'start');
      }
      if (data.end && !isValidTime(data.end)) {
        hasError = true;
        markInputError(date, 'end');
      }
    });

    if (hasError) {
      showStatus('時刻の形式が正しくありません（HH:MM）', 'error');
      return;
    }

    if (!confirm(`${dateMap.size}日分の勤怠を登録します。よろしいですか？`)) return;

    bulkButton.disabled = true;
    bulkButton.textContent = '登録中...';

    let successCount = 0;
    let errorCount = 0;
    const total = dateMap.size;

    for (const [date, data] of dateMap) {
      try {
        bulkButton.textContent = `登録中... (${successCount + errorCount + 1}/${total})`;
        await submitAttendanceForDate(date, data);
        successCount++;
        markInputSuccess(date);
      } catch (err) {
        console.error(`[KOT Quick Input] ${date} の登録に失敗:`, err);
        errorCount++;
        markInputError(date, 'start');
        markInputError(date, 'end');
      }

      if (successCount + errorCount < total) {
        await sleep(CONFIG.requestDelay);
      }
    }

    bulkButton.disabled = false;
    bulkButton.textContent = '一括登録';

    if (errorCount === 0) {
      showStatus(`${successCount}日分の勤怠を登録しました`, 'success');
    } else {
      showStatus(`完了: 成功${successCount}件, 失敗${errorCount}件`, 'error');
    }
  }

  /**
   * 1日分の勤怠を登録
   */
  async function submitAttendanceForDate(dateYYYYMMDD, data) {
    const { day, rowData, start, end } = data;
    const formAction = document.querySelector('form').action;

    // ============================================================
    // Step 1: 行のhiddenデータで編集画面HTMLを取得
    // ============================================================
    const editParams = new URLSearchParams();

    // 行のhiddenフィールドをそのまま使う
    for (const [key, val] of Object.entries(rowData)) {
      editParams.set(key, val);
    }

    // action_id=2 を追加（編集画面遷移）
    editParams.set('action_id', '2');

    console.log(`[KOT Quick Input] ${dateYYYYMMDD} 編集画面取得中...`);

    const editResponse = await fetch(formAction, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: editParams.toString(),
      credentials: 'same-origin',
      redirect: 'follow',
    });

    if (!editResponse.ok) {
      throw new Error(`編集画面の取得に失敗: HTTP ${editResponse.status}`);
    }

    const editHtml = await editResponse.text();
    const parser = new DOMParser();
    const editDoc = parser.parseFromString(editHtml, 'text/html');

    // ============================================================
    // Step 2: 編集画面のフォームから登録POSTを送信
    // ============================================================
    const editForm = editDoc.querySelector('#working_edit_form') || editDoc.querySelector('form');
    if (!editForm) {
      const bodyText = editDoc.body?.textContent?.trim().slice(0, 200) || '';
      console.error('[KOT Quick Input] 編集画面HTML:', bodyText);
      throw new Error('編集フォームが見つかりません');
    }

    console.log(`[KOT Quick Input] ${dateYYYYMMDD} 編集フォーム取得成功、登録中...`);

    // 編集フォームの全hiddenフィールドを収集
    const submitParams = new URLSearchParams();
    const editHiddens = editForm.querySelectorAll('input[type="hidden"]');
    const seenEdit = new Set();
    editHiddens.forEach((h) => {
      if (!h.name || seenEdit.has(h.name)) return;
      seenEdit.add(h.name);
      submitParams.set(h.name, h.value);
    });

    // action_id=1（打刻登録）
    submitParams.set('action_id', '1');

    // 出勤・退勤時刻をセット
    const dateFormatted = `${dateYYYYMMDD.slice(0, 4)}/${dateYYYYMMDD.slice(4, 6)}/${dateYYYYMMDD.slice(6, 8)}`;

    if (start) {
      submitParams.set('recording_type_code_1', '1');
      submitParams.set('recording_timestamp_time_1', start);
      submitParams.set('recording_timestamp_date_1', dateFormatted);
      // 時分を分割して設定（念のため）
      const [h, m] = start.split(':');
      submitParams.set('recording_timestamp_hour_1', h);
      submitParams.set('recording_timestamp_minute_1', m);
      submitParams.set('recording_timestamp_year_1', dateYYYYMMDD.slice(0, 4));
      submitParams.set('recording_timestamp_month_1', dateYYYYMMDD.slice(4, 6));
      submitParams.set('recording_timestamp_day_1', dateYYYYMMDD.slice(6, 8));
    }

    if (end) {
      submitParams.set('recording_type_code_2', '2');
      submitParams.set('recording_timestamp_time_2', end);
      submitParams.set('recording_timestamp_date_2', dateFormatted);
      const [h, m] = end.split(':');
      submitParams.set('recording_timestamp_hour_2', h);
      submitParams.set('recording_timestamp_minute_2', m);
      submitParams.set('recording_timestamp_year_2', dateYYYYMMDD.slice(0, 4));
      submitParams.set('recording_timestamp_month_2', dateYYYYMMDD.slice(4, 6));
      submitParams.set('recording_timestamp_day_2', dateYYYYMMDD.slice(6, 8));
    }

    // 送信
    const submitAction = editForm.action || formAction;
    const submitResponse = await fetch(submitAction, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: submitParams.toString(),
      credentials: 'same-origin',
      redirect: 'follow',
    });

    if (!submitResponse.ok && submitResponse.status !== 302) {
      throw new Error(`登録に失敗: HTTP ${submitResponse.status}`);
    }

    console.log(`[KOT Quick Input] ${dateYYYYMMDD} 登録完了`);
    return true;
  }

  // ==========================================================================
  // ユーティリティ関数
  // ==========================================================================

  function parseDateFromCell(cell) {
    const text = cell.textContent.trim();
    const match = text.match(/(\d{2})\/(\d{2})/);
    if (match) {
      const month = match[1];
      const day = match[2];
      const year = getCurrentYear();
      return { dateYYYYMMDD: `${year}${month}${day}`, dayPadded: day };
    }
    return null;
  }

  function extractTimeFromCell(cell) {
    const text = cell.textContent.trim();
    const match = text.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : '';
  }

  function getCurrentYear() {
    const candidates = document.querySelectorAll('[class*="header"], [class*="title"], [class*="year"]');
    for (const el of candidates) {
      const match = el.textContent.match(/(20\d{2})/);
      if (match) return match[1];
    }
    return new Date().getFullYear().toString();
  }

  function isValidTime(timeStr) {
    if (!timeStr) return true;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return false;
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    return hours >= 0 && hours <= 47 && minutes >= 0 && minutes <= 59;
  }

  function markInputError(date, type) {
    const input = document.querySelector(`.kot-time-input[data-date="${date}"][data-type="${type}"]`);
    if (input) {
      input.classList.remove('kot-success');
      input.classList.add('kot-error');
    }
  }

  function markInputSuccess(date) {
    const inputs = document.querySelectorAll(`.kot-time-input[data-date="${date}"]`);
    inputs.forEach((input) => {
      input.classList.remove('kot-modified', 'kot-error');
      input.classList.add('kot-success');
    });
  }

  function showStatus(message, type) {
    const existing = document.querySelector('.kot-status-msg');
    if (existing) existing.remove();

    const msg = document.createElement('div');
    msg.className = `kot-status-msg ${type}`;
    msg.textContent = message;
    document.body.appendChild(msg);

    setTimeout(() => {
      msg.style.opacity = '0';
      setTimeout(() => msg.remove(), 300);
    }, 4000);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // SPA対応 - DOMの変化を監視
  // ==========================================================================

  const observer = new MutationObserver(() => {
    const container = document.querySelector(CONFIG.tableContainerSelector);
    if (container && !isInitialized) {
      init();
    } else if (!container && isInitialized) {
      isInitialized = false;
      if (bulkButton) {
        bulkButton.remove();
        bulkButton = null;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  init();
  console.log('[KOT Quick Input] 拡張機能が読み込まれました');
})();
