/** Skrypt mapy: Generowanie protokołu i zapis do rejestru; podpięcie przycisków okien. */

export function docGenerateBrowserScript(): string {
  return `    function runBulkDocGenerate() {
      if (transportApiEnabled && !window.__docModalDataReady) {
        showMapFormError_(
          'MAP-E-DOC-WAIT',
          'Poczekaj na załadowanie danych transportu.',
          'Generowanie zbiorcze ruszy, gdy modal skończy pobierać dane.',
          'map/browser/docGenerate.ts runBulkDocGenerate',
          '__docModalDataReady === false'
        );
        return;
      }
      if (!transportApiEnabled) {
        showMapFormError_(
          'MAP-E-BULK-OFFLINE',
          'Tryb zbiorczy wymaga połączenia z rejestrem transportów.',
          'Protokoły zbiorcze nie powstaną bez TRANSPORT_WEBAPP_URL.',
          'map/browser/docGenerate.ts runBulkDocGenerate',
          'transportApiEnabled === false'
        );
        return;
      }
      var form = formForGenerate_();
      if (!form) return;
      var jobs = window.__docBulkPointJobs || [];
      if (jobs.length === 0) {
        showMapFormError_(
          'MAP-E-BULK-EMPTY',
          'Brak zaznaczonych punktów do protokołu.',
          'Nie ma czego generować. Zaznacz pinezki i otwórz modal ponownie.',
          'map/browser/docGenerate.ts runBulkDocGenerate',
          '__docBulkPointJobs puste'
        );
        return;
      }
      if (offerBolecinAwizacja_(form)) return;
      var bolecinError = '';
      resolveRouteFieldsBeforeSave(form.routeFields).then(function (routeFields) {
      if (form.routeFields && !routeFields) return;
      form.routeFields = routeFields;
      var okBtn = document.getElementById('doc-btn-ok');
      var filterInfo = document.getElementById('doc-filter-info');
      if (okBtn) okBtn.disabled = true;
      setTransportDatesLoading(true, 'Generowanie dokumentów…');
      ensureDocxLibrariesLoaded().then(function () {
        var generated = 0;
        var failed = 0;
        var failures = [];
        var bolecinPending = true;
        var chain = Promise.resolve();
        jobs.forEach(function (job, jobIdx) {
          var shopAdres = '';
          chain = chain.then(function () {
            var p = adresy[job.pointIdx];
            shopAdres = p && p.adres ? String(p.adres) : '';
            if (!p) return Promise.resolve();
            if (filterInfo) {
              filterInfo.textContent = 'Generowanie ' + (jobIdx + 1) + ' / ' + jobs.length + ': ' + p.adres;
            }
            var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
            var transportPayload = {
              numer: '',
              adresSklepu: p.adres,
              podmiotHandlowy: podmiot,
              sklep: p.sklep || '',
              dataOdbioru: form.dz,
              ktoOdbiera: form.prOpt.label,
              miejsceZrzutu: form.mdOpt.label,
              rodzajZbiorki: aggregateRodzajZbiorkiFromSealRows(job.filteredSeals),
              iloscWorkow: (job.filteredSeals || []).length,
              komentarz1: form.komentarz1,
              komentarz2: form.komentarz2
            };
            assignRouteBody(transportPayload, form.routeFields);
            if (bolecinPending) assignBulkBolecinAwizacja_(transportPayload, form.mdOpt);
            return appendTransportRow(transportPayload).then(function (resp) {
              if (resp && resp.ok && transportPayload.awizujBolecin) {
                if (resp.bolecinError) {
                  bolecinError = String(resp.bolecinError);
                } else {
                  bolecinPending = false;
                  bolecinError = '';
                }
              }
              if (!resp || !resp.ok) {
                var apiErr = new Error(
                  resp && resp.notJson
                    ? String(resp.technical || 'nie-JSON')
                    : (resp && resp.error ? String(resp.error) : 'błąd API')
                );
                apiErr.bulkStage = 'rejestr';
                throw apiErr;
              }
              if (resp.bolecinError && !bolecinError) bolecinError = String(resp.bolecinError);
              rememberRouteAfterSuccessfulSave(form.routeFields);
              var numerZlecenia = String(resp.numer || '');
              var preparedLists = buildDocListsFromSealRows(job.filteredSeals);
              try {
                renderDocxAndDownload(p, form.pr, form.md, form.prOpt, form.dz, form.dzPlik, numerZlecenia, job.filteredSeals, preparedLists, { closeModal: false });
              } catch (renderErr) {
                renderErr.bulkStage = 'word';
                throw renderErr;
              }
              updateTransportCutoffAfterAppend(p, form.dz, form.prOpt.label);
              if (typeof markerEntries !== 'undefined') {
                markerEntries.forEach(function (entry) {
                  if (entry.pointIdx === job.pointIdx) refreshMarkerDisplay(entry);
                });
              }
              generated += 1;
              return delayMs(400);
            });
          }).catch(function (err) {
            console.error(err);
            failed += 1;
            var stageNote = err && err.bulkStage === 'word'
              ? 'Word nie powstał, wiersz rejestru mógł już wejść'
              : 'rejestr nie zapisany';
            failures.push((shopAdres || 'bez adresu') + ' — ' + stageNote + ' — ' + String(err && err.message || err));
          });
        });
        return chain.then(function () {
          if (failed > 0) {
            var bulkTotal = generated + failed;
            var anyWord = false;
            var fi;
            for (fi = 0; fi < failures.length; fi++) {
              if (failures[fi].indexOf('Word nie powstał') >= 0) anyWord = true;
            }
            showMapErrorCard({
              code: 'MAP-E-BULK-GENERATE',
              summary: generated > 0
                ? 'Część protokołów zbiorczych się nie udała.'
                : 'Nie udało się wygenerować protokołów zbiorczych.',
              effect: 'Wygenerowano ' + generated + ' z ' + bulkTotal + '. Nie udało się: ' + failed + '.'
                + (anyWord ? ' Tam, gdzie padł Word, wiersz rejestru mógł już być w arkuszu.' : ''),
              place: 'map/browser/docGenerate.ts runBulkDocGenerate',
              technical: failures.join(' | ')
            });
          }
          var head = (failed === 0 || generated > 0)
            ? ('Wygenerowano ' + generated + ' protokołów.')
            : '';
          clearBulkSelection();
          closeDocModal();
          showAwizacjaNotice_(head, bolecinError, null, false);
        });
      }, function (libsErr) {
        console.error(libsErr);
        showMapErrorCard({
          code: 'MAP-E-WORD-LIBS',
          summary: 'Nie udało się załadować bibliotek Word (PizZip/docxtemplater).',
          effect: 'Protokoły zbiorcze się nie pobrały. Sprawdź połączenie z internetem i spróbuj ponownie.',
          place: 'map/browser/docGenerate.ts runBulkDocGenerate',
          technical: String(libsErr && libsErr.message || libsErr)
        });
      }).catch(function (err) {
        docGenerateCrashed_(err, 'map/browser/docGenerate.ts runBulkDocGenerate');
      }).then(function () {
        if (okBtn) okBtn.disabled = false;
        setTransportDatesLoading(false);
      });
      }).catch(function (err) { docGenerateCrashed_(err, 'map/browser/docGenerate.ts runBulkDocGenerate'); });
    }
    function runDocGenerate() {
      if (window.__docModalMode === 'bulk') {
        runBulkDocGenerate();
        return;
      }
      if (transportApiEnabled && !window.__docModalDataReady) {
        showMapFormError_(
          'MAP-E-DOC-WAIT',
          'Poczekaj na załadowanie danych transportu.',
          'Dokument powstanie, gdy modal skończy pobierać numer i filtr worków.',
          'map/browser/docGenerate.ts runDocGenerate',
          '__docModalDataReady === false'
        );
        return;
      }
      var idx = window.__currentDocPointIdx;
      if (idx == null || idx < 0 || !adresy[idx]) {
        showMapFormError_(
          'MAP-E-DOC-POINT',
          'Brak punktu na mapie.',
          'Dokument się nie pobierze. Zamknij okno i wybierz pinezkę jeszcze raz.',
          'map/browser/docGenerate.ts runDocGenerate',
          '__currentDocPointIdx poza adresy'
        );
        return;
      }
      var form = formForGenerate_();
      if (!form) return;
      if (offerBolecinAwizacja_(form)) return;
      resolveRouteFieldsBeforeSave(form.routeFields).then(function (routeFields) {
      if (form.routeFields && !routeFields) return;
      form.routeFields = routeFields;
      var pr = form.pr;
      var md = form.md;
      var prOpt = form.prOpt;
      var mdOpt = form.mdOpt;
      var dz = form.dz;
      var dzPlik = form.dzPlik;
      var p = adresy[idx];
      var filteredSeals = window.__docFilteredSeals || p.sealRows || [];
      var numEl = document.getElementById('doc-inp-numer-zlecenia');
      var okBtn = document.getElementById('doc-btn-ok');
      if (okBtn) okBtn.disabled = true;
      setTransportDatesLoading(true, 'Generowanie dokumentu…');
      rebuildDocPreparedLists(filteredSeals);
      var preparedLists = window.__docPreparedLists;
      function finishWithNumber(numerZlecenia, keepLoading) {
        return ensureDocxLibrariesLoaded().then(function () {
          try {
            if (!numerZlecenia) {
              showMapErrorCard({
                code: 'MAP-E-NO-NUMBER',
                summary: 'Brak numeru zlecenia transportowego.',
                effect: 'Dokument się nie pobrał. Arkusz nie nadał numeru.',
                place: 'map/browser/docGenerate.ts finishWithNumber',
                technical: 'pusty numer'
              });
              return false;
            }
            renderDocxAndDownload(p, pr, md, prOpt, dz, dzPlik, numerZlecenia, filteredSeals, preparedLists);
            return true;
          } catch (err) {
            console.error(err);
            showMapErrorCard({
              code: 'MAP-E-DOC-RENDER',
              summary: 'Nie udało się utworzyć dokumentu.',
              effect: 'Plik Word się nie pobrał. Sprawdź szablon (tagi {{miejsce_zaladunku}}, {{przewoznik}}, {{numer_zlecenia_transportowego}}) i spróbuj ponownie.',
              place: 'map/browser/docGenerate.ts finishWithNumber',
              technical: String(err && err.message || err)
            });
            return false;
          } finally {
            if (!keepLoading) {
              if (okBtn) okBtn.disabled = false;
              setTransportDatesLoading(false);
            }
          }
        }).catch(function (err) {
          console.error(err);
          showMapErrorCard({
            code: 'MAP-E-WORD-LIBS',
            summary: 'Nie udało się załadować bibliotek Word (PizZip/docxtemplater).',
            effect: 'Dokument się nie pobrał. Sprawdź połączenie z internetem i spróbuj ponownie.',
            place: 'map/browser/docGenerate.ts finishWithNumber',
            technical: String(err && err.message || err)
          });
          if (!keepLoading) {
            if (okBtn) okBtn.disabled = false;
            setTransportDatesLoading(false);
          }
          return false;
        });
      }
      if (transportApiEnabled) {
        var podmiot = p.podmiotHandlowy || (p.podmiotyHandlowe && p.podmiotyHandlowe[0]) || '';
        var numerWpisany = numEl ? String(numEl.value).trim() : '';
        var manualNumer = isManualTransportNumer(numerWpisany, window.__docPreviewNumer);
        var transportPayload = {
          numer: manualNumer ? numerWpisany : '',
          adresSklepu: p.adres,
          podmiotHandlowy: podmiot,
          sklep: p.sklep || '',
          dataOdbioru: dz,
          ktoOdbiera: prOpt.label,
          miejsceZrzutu: mdOpt.label,
          rodzajZbiorki: aggregateRodzajZbiorkiFromSealRows(filteredSeals),
          iloscWorkow: iloscWorkowFromAwizacja_(filteredSeals.length),
          komentarz1: form.komentarz1,
          komentarz2: form.komentarz2
        };
        assignRouteBody(transportPayload, form.routeFields);
        assignBolecinAwizacja_(transportPayload, form.mdOpt);
        var awizacjaChoice = window.__bolecinAwizacjaChoice;
        if (manualNumer) {
          var docDownloaded = finishWithNumber(numerWpisany, true);
          appendTransportRow(transportPayload).then(function (resp) {
            return docDownloaded.then(function (downloaded) {
              if (!resp || !resp.ok) {
                mapApiErrorCard_({
                  code: 'MAP-E-REGISTER-SAVE',
                  summary: downloaded
                    ? 'Dokument pobrany, ale zapis w arkuszu nie powiódł się.'
                    : 'Nie udało się zapisać transportu w arkuszu.',
                  effect: downloaded
                    ? 'Protokół jest na dysku. Wiersz rejestru transportu może nie być w arkuszu.'
                    : 'Protokół też się nie pobrał (przyczyna na osobnej karcie). Wiersz rejestru transportu może nie być w arkuszu.',
                  place: 'map/browser/docGenerate.ts runDocGenerate',
                  technical: String(resp && resp.error ? resp.error : 'błąd API')
                }, resp, null);
                return;
              }
              rememberRouteAfterSuccessfulSave(form.routeFields);
              updateTransportCutoffAfterAppend(p, dz, prOpt.label);
              if (typeof markerEntries !== 'undefined') {
                markerEntries.forEach(function (entry) {
                  if (entry.pointIdx === idx) refreshMarkerDisplay(entry);
                });
              }
              showAwizacjaNotice_(
                (downloaded ? 'Dokument pobrany.\\n' : '') + 'Zapisano transport: ' + numerWpisany,
                resp.bolecinError,
                awizacjaChoice
              );
            });
          }, function (err) {
            console.error(err);
            return docDownloaded.then(function (downloaded) {
              mapApiErrorCard_({
                code: 'MAP-E-REGISTER-SAVE',
                summary: downloaded
                  ? 'Dokument pobrany, ale nie udało się zapisać transportu w arkuszu.'
                  : 'Nie udało się zapisać transportu w arkuszu.',
                effect: downloaded
                  ? 'Protokół jest na dysku. Sprawdź połączenie i URL Web App.'
                  : 'Protokół też się nie pobrał (przyczyna na osobnej karcie). Sprawdź połączenie i URL Web App.',
                place: 'map/browser/docGenerate.ts runDocGenerate',
                technical: String(err && err.message || err)
              }, null, err);
            });
          }).catch(function (err) {
            docGenerateCrashed_(err, 'map/browser/docGenerate.ts runDocGenerate');
          }).then(function () {
            if (okBtn) okBtn.disabled = false;
            setTransportDatesLoading(false);
          });
          return;
        }
        appendTransportRow(transportPayload).then(function (resp) {
          if (!resp || !resp.ok) {
            mapApiErrorCard_({
              code: 'MAP-E-REGISTER-SAVE',
              summary: 'Nie udało się zapisać transportu w arkuszu.',
              effect: 'Dokument się nie pobrał. Wiersz rejestru nie wszedł.',
              place: 'map/browser/docGenerate.ts runDocGenerate',
              technical: String(resp && resp.error ? resp.error : 'błąd API')
            }, resp, null);
            if (okBtn) okBtn.disabled = false;
            setTransportDatesLoading(false);
            return;
          }
          rememberRouteAfterSuccessfulSave(form.routeFields);
          updateTransportCutoffAfterAppend(p, dz, prOpt.label);
          if (typeof markerEntries !== 'undefined') {
            markerEntries.forEach(function (entry) {
              if (entry.pointIdx === idx) refreshMarkerDisplay(entry);
            });
          }
          showAwizacjaNotice_('', resp.bolecinError, awizacjaChoice);
          finishWithNumber(String(resp.numer || ''));
        }).catch(function (err) {
          console.error(err);
          mapApiErrorCard_({
            code: 'MAP-E-REGISTER-SAVE',
            summary: 'Nie udało się zapisać transportu w arkuszu.',
            effect: 'Dokument się nie pobrał. Sprawdź połączenie i URL Web App (TRANSPORT_WEBAPP_URL).',
            place: 'map/browser/docGenerate.ts runDocGenerate',
            technical: String(err && err.message || err)
          }, null, err);
          if (okBtn) okBtn.disabled = false;
          setTransportDatesLoading(false);
        });
        return;
      }
      var numerManual = numEl ? String(numEl.value).trim() : '';
      finishWithNumber(numerManual);
      }).catch(function (err) { docGenerateCrashed_(err, 'map/browser/docGenerate.ts runDocGenerate'); });
    }

    if (wordDocEnabled) {
      initDocComboboxes();
      document.getElementById('doc-btn-cancel').onclick = closeDocModal;
      document.getElementById('doc-btn-ok').onclick = runDocGenerate;
      var bolecinAwCancel = document.getElementById('bolecin-aw-cancel');
      var bolecinAwSkip = document.getElementById('bolecin-aw-skip');
      var bolecinAwAdd = document.getElementById('bolecin-aw-add');
      var bolecinAwModal = document.getElementById('bolecin-aw-modal');
      if (bolecinAwCancel) bolecinAwCancel.onclick = closeBolecinAwizacjaModal_;
      if (bolecinAwSkip) bolecinAwSkip.onclick = function () { acceptBolecinAwizacja_(false); };
      if (bolecinAwAdd) bolecinAwAdd.onclick = function () { acceptBolecinAwizacja_(true); };
      if (bolecinAwModal) {
        bolecinAwModal.onclick = function (ev) {
          if (ev.target.id === 'bolecin-aw-modal') closeBolecinAwizacjaModal_();
        };
      }
      var bezListyChk = document.getElementById('doc-chk-bez-listy-plomb');
      if (bezListyChk) {
        bezListyChk.onchange = function () { refreshAllDocPreparedLists(); };
      }
      var routeChk = document.getElementById('doc-chk-odbior-z-trasy');
      if (routeChk) routeChk.onchange = onRouteCheckboxChange;
      var routeNameInput = document.getElementById('doc-inp-trasa');
      if (routeNameInput) routeNameInput.addEventListener('input', onRouteNameInput);
      var nowaTrasaBtn = document.getElementById('doc-btn-nowa-trasa');
      if (nowaTrasaBtn) nowaTrasaBtn.onclick = onNowaTrasaClick;
      var routeRateInput = document.getElementById('doc-inp-stawka-trasy');
      if (routeRateInput) routeRateInput.addEventListener('input', onRouteRateInput);
      var routeDateInput = document.getElementById('doc-inp-data-zaladunku');
      if (routeDateInput) routeDateInput.addEventListener('change', refreshRouteNameField);
      document.getElementById('doc-modal').onclick = function(ev) {
        if (ev.target.id === 'doc-modal') closeDocModal();
      };
    }

    if (transportApiEnabled) {
      initDayMultiPickers(['bulk-rates-dni']);
      var bulkRatesCancel = document.getElementById('bulk-rates-btn-cancel');
      var bulkRatesOk = document.getElementById('bulk-rates-btn-ok');
      var bulkRatesModalEl = document.getElementById('bulk-rates-modal');
      if (bulkRatesCancel) bulkRatesCancel.onclick = closeBulkRatesModal;
      if (bulkRatesOk) bulkRatesOk.onclick = runBulkRatesSave;
      if (bulkRatesModalEl) {
        bulkRatesModalEl.onclick = function (ev) {
          if (ev.target.id === 'bulk-rates-modal') closeBulkRatesModal();
        };
      }
      var bulkTargetRadios = document.querySelectorAll('input[name="bulk-rates-target"]');
      var bri;
      for (bri = 0; bri < bulkTargetRadios.length; bri++) {
        bulkTargetRadios[bri].addEventListener('change', syncBulkRatesTargetUi);
      }
      var bulkValidateIds = ['bulk-rates-podjazd', 'bulk-rates-worek', 'bulk-rates-trasa', 'bulk-rates-kwota-trasy'];
      var bvi;
      for (bvi = 0; bvi < bulkValidateIds.length; bvi++) {
        var bulkField = document.getElementById(bulkValidateIds[bvi]);
        if (!bulkField) continue;
        bulkField.addEventListener('input', validateBulkRatesFields);
        bulkField.addEventListener('change', validateBulkRatesFields);
      }
    }

`;
}
