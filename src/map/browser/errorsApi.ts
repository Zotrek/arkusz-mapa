/** Skrypt mapy: Karty błędów, odczyt odpowiedzi API, komunikaty, daty ostatnich transportów. */

export function errorsApiBrowserScript(): string {
  return `    function mapErrorOneLine_(value) {
      return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    }
    function mapErrorReportText(report) {
      var code = mapErrorOneLine_(report && report.code) || 'MAP-E-UNKNOWN';
      var place = mapErrorOneLine_(report && report.place) || 'nieznane miejsce';
      var summary = mapErrorOneLine_(report && report.summary) || 'Coś się nie udało.';
      var effect = mapErrorOneLine_(report && report.effect) || 'Część danych może być niekompletna.';
      var technical = mapErrorOneLine_(report && report.technical) || 'brak szczegółu';
      return [
        'ARKUSZ-MAPA-ERROR',
        'kod: ' + code,
        'miejsce: ' + place,
        'objaw: ' + summary,
        'skutek: ' + effect,
        'technicznie: ' + technical
      ].join('\\n');
    }
    /** Karta błędu u góry mapy. Nie blokuje kliknięć w mapę. Znika po Zamknij. */
    function showMapErrorCard(report) {
      var summary = mapErrorOneLine_(report && report.summary) || 'Coś się nie udało.';
      var effect = mapErrorOneLine_(report && report.effect) || 'Część danych może być niekompletna.';
      var reportText = mapErrorReportText(report);
      var stack = document.getElementById('map-error-stack');
      if (!stack) {
        window.alert(summary + '\\n' + effect + '\\nMożesz dalej pracować na mapie.\\n\\n' + reportText);
        return;
      }
      var card = document.createElement('article');
      card.className = 'map-error-card';
      var title = document.createElement('h2');
      title.className = 'map-error-card-title';
      title.textContent = summary;
      var effectEl = document.createElement('p');
      effectEl.className = 'map-error-card-effect';
      effectEl.textContent = effect;
      var continueEl = document.createElement('p');
      continueEl.className = 'map-error-card-continue';
      continueEl.textContent = 'Możesz dalej pracować na mapie.';
      var label = document.createElement('label');
      label.className = 'map-error-card-label';
      label.textContent = 'Raport do wklejenia w czacie';
      var field = document.createElement('textarea');
      field.className = 'map-error-card-report';
      field.readOnly = true;
      field.spellcheck = false;
      field.rows = 6;
      field.value = reportText;
      label.appendChild(field);
      var actions = document.createElement('div');
      actions.className = 'map-error-card-actions';
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'map-error-card-copy';
      copyBtn.textContent = 'Kopiuj raport';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'map-error-card-dismiss';
      closeBtn.textContent = 'Zamknij';
      function markCopy(ok) {
        copyBtn.textContent = ok ? 'Skopiowano' : 'Zaznaczono — skopiuj ręcznie';
      }
      copyBtn.addEventListener('click', function () {
        field.focus();
        field.select();
        var text = field.value || '';
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
        if (copied) {
          markCopy(true);
          return;
        }
        var clipboard = navigator.clipboard;
        if (clipboard && clipboard.writeText) {
          clipboard.writeText(text).then(function () { markCopy(true); }).catch(function () { markCopy(false); });
          return;
        }
        markCopy(false);
      });
      closeBtn.addEventListener('click', function () {
        if (card.parentNode) card.parentNode.removeChild(card);
        if (!stack.querySelector('.map-error-card')) stack.hidden = true;
      });
      actions.appendChild(copyBtn);
      actions.appendChild(closeBtn);
      card.appendChild(title);
      card.appendChild(effectEl);
      card.appendChild(continueEl);
      card.appendChild(label);
      card.appendChild(actions);
      stack.appendChild(card);
      stack.hidden = false;
    }
    function showMapFormError_(code, summary, effect, place, technical) {
      showMapErrorCard({
        code: code,
        summary: summary,
        effect: effect,
        place: place,
        technical: technical || summary
      });
    }
    /** Tekst ze strony HTML (tytuł i treść), bez znaczników. Surowy DOCTYPE zasłania wyjątek Google. */
    function mapHtmlSnippet_(body) {
      var raw = String(body || '');
      var title = '';
      var titleMatch = raw.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
      }
      var text = raw
        .replace(new RegExp('<script[\\\\s\\\\S]*?<' + '/script>', 'gi'), ' ')
        .replace(new RegExp('<style[\\\\s\\\\S]*?<' + '/style>', 'gi'), ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\\s+/g, ' ')
        .trim();
      if (title && text.indexOf(title) === -1) text = (title + ' — ' + text).trim();
      if (text.length > 280) text = text.slice(0, 280);
      return text;
    }
    /** Body, które nie jest JSON (logowanie Google, limit). 401 zostaje na overlayu sesji. */
    function readMapJson_(res) {
      return res.text().then(function (text) {
        var body = String(text == null ? '' : text);
        if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
        body = body.trim();
        if (res.status === 401) {
          return { ok: false, error: 'unauthorized', status: 401 };
        }
        var first = body.charAt(0);
        if (first === '{' || first === '[') {
          try { return JSON.parse(body); } catch (eParse) {}
        }
        var snippet = mapHtmlSnippet_(body);
        return {
          ok: false,
          error: 'not_json',
          notJson: true,
          status: res.status,
          technical: 'HTTP ' + res.status + (snippet ? ': ' + snippet : '')
        };
      });
    }
    function mapApiErrorCard_(report, resp, err) {
      if ((resp && resp.status === 401) || (err && err.status === 401)) return;
      if (resp && resp.error === 'proxy_auth_mismatch') return;
      var notJson = !!((resp && resp.notJson) || (err && err.notJson));
      var technical = report && report.technical;
      if (notJson) {
        technical = String((resp && resp.technical) || (err && err.technical) || (err && err.message) || 'nie-JSON');
      }
      showMapErrorCard({
        code: notJson ? 'MAP-E-NOT-JSON' : (report && report.code),
        summary: report && report.summary,
        effect: report && report.effect,
        place: report && report.place,
        technical: technical
      });
    }
    var mapNoticeHideTimer = 0;
    function showMapNotice(message, kind, options) {
      var el = document.getElementById('map-app-notice');
      var textEl = document.getElementById('map-app-notice-text');
      var closeBtn = document.getElementById('map-app-notice-close');
      var persist = !!(options && options.persist);
      if (!el || !textEl) {
        if (message) window.alert(message);
        return;
      }
      textEl.textContent = message || '';
      el.classList.remove('is-ok', 'is-error', 'is-persist');
      if (kind === 'ok') el.classList.add('is-ok');
      if (kind === 'error') el.classList.add('is-error');
      if (persist) el.classList.add('is-persist');
      if (closeBtn) {
        closeBtn.hidden = !persist;
        if (!closeBtn.getAttribute('data-bound')) {
          closeBtn.setAttribute('data-bound', '1');
          closeBtn.onclick = function () {
            if (mapNoticeHideTimer) window.clearTimeout(mapNoticeHideTimer);
            mapNoticeHideTimer = 0;
            el.hidden = true;
          };
        }
      }
      el.hidden = !message;
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      if (mapNoticeHideTimer) window.clearTimeout(mapNoticeHideTimer);
      mapNoticeHideTimer = 0;
      if (!message || persist) return;
      mapNoticeHideTimer = window.setTimeout(function () {
        el.hidden = true;
        mapNoticeHideTimer = 0;
      }, 6000);
    }
    function loadBulkTransportDates() {
      window.__transportDateByKey = {};
      window.__transportKtoOdbieraByKey = {};
      window.__transportDatesLoaded = false;
      if (!transportApiEnabled) {
        window.__transportDatesLoaded = true;
        setTransportDatesLoading(false);
        return Promise.resolve();
      }
      setTransportDatesLoading(true);
      return fetchTransportGet({ action: 'bulkLastTransportDates' }).then(function (resp) {
        var byKey = {};
        var ktoByKey = {};
        if (resp && resp.ok && resp.shops) {
          resp.shops.forEach(function (s) {
            if (s && s.key != null && s.lastTransportDateMs != null) {
              byKey[s.key] = s.lastTransportDateMs;
              if (s.lastKtoOdbiera) {
                ktoByKey[s.key] = String(s.lastKtoOdbiera).trim();
              }
            }
          });
        } else if (!resp || resp.ok === false) {
          mapApiErrorCard_({
            code: 'MAP-E-TRANSPORT-DATES',
            summary: 'Nie udało się pobrać ostatnich dat transportu.',
            effect: 'Pinezki są bez ostatniego odbioru. Filtr worków nie odcina starych dat.',
            place: 'map/browser/errorsApi.ts loadBulkTransportDates',
            technical: String(resp && resp.error ? resp.error : 'ok: false')
          }, resp, null);
        }
        window.__transportDateByKey = byKey;
        window.__transportKtoOdbieraByKey = ktoByKey;
        window.__transportDatesLoaded = true;
      }).catch(function (err) {
        console.error(err);
        window.__transportDatesLoaded = true;
        mapApiErrorCard_({
          code: 'MAP-E-TRANSPORT-DATES',
          summary: 'Nie udało się pobrać ostatnich dat transportu.',
          effect: 'Pinezki są bez ostatniego odbioru. Filtr worków nie odcina starych dat.',
          place: 'map/browser/errorsApi.ts loadBulkTransportDates',
          technical: String(err && err.message || err)
        }, null, err);
      }).then(function () {
        return refreshAllMarkerDisplaysAfterTransport();
      }).catch(function (err) {
        console.error(err);
        showMapFormError_(
          'MAP-E-MARKER-REFRESH',
          'Daty transportu są pobrane, ale pinezki się nie odświeżyły.',
          'Na mapie mogą zostać stare kolory i liczby worków. Odśwież stronę.',
          'map/browser/errorsApi.ts loadBulkTransportDates',
          String(err && err.message || err)
        );
      }).then(function () {
        setTransportDatesLoading(false);
      });
    }
`;
}
