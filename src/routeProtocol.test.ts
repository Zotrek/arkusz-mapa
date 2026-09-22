import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  assignRouteBody,
  routeBodyFields,
  routeNameRememberedAfterSave,
  routeNameToShow,
  routeProtocolBrowserScript,
  routeRateFromLookup,
  routeRateConflictsWithExisting,
  routeRateFromSession,
  routeRateToKeep,
  type RouteBodyFields,
  type RouteNameShowInput,
} from './routeProtocol.js';

type RouteVm = {
  routeBodyFields: (checked: boolean, name: string, rate: string) => RouteBodyFields | null;
  routeNameToShow: (input: RouteNameShowInput) => string;
  routeNameRememberedAfterSave: (savedName: string) => string;
  routeRateFromLookup: (rate: unknown) => string;
  routeRateToKeep: (currentRate: string, lookedUpRate: unknown, userEdited: boolean) => string;
  routeRateFromSession: (
    shownName: string,
    currentRate: string,
    sessionName: string,
    sessionRate: string,
  ) => string;
  routeRateConflictsWithExisting: (routeName: string, nextRate: string, existingRate: string) => boolean;
  assignRouteBody: (
    payload: Record<string, unknown> | null,
    fields: RouteBodyFields | null,
  ) => Record<string, unknown> | null;
};

function browserFns(): RouteVm {
  const context: Partial<RouteVm> = {};
  runInNewContext(routeProtocolBrowserScript(), context);
  if (
    typeof context.routeBodyFields !== 'function' ||
    typeof context.routeNameToShow !== 'function' ||
    typeof context.routeNameRememberedAfterSave !== 'function' ||
    typeof context.routeRateFromLookup !== 'function' ||
    typeof context.routeRateToKeep !== 'function' ||
    typeof context.routeRateFromSession !== 'function' ||
    typeof context.routeRateConflictsWithExisting !== 'function' ||
    typeof context.assignRouteBody !== 'function'
  ) {
    throw new Error('Skrypt przeglądarki nie ma funkcji okna protokołu');
  }
  return context as RouteVm;
}

const vm = browserFns();

describe('routeProtocol', () => {
  it('test_routeBodyFields_when_checkbox_off_should_omit_route', () => {
    expect(routeBodyFields(false, 'gpw-18.09.26-01', '150')).toBeNull();
    expect(vm.routeBodyFields(false, 'gpw-18.09.26-01', '150')).toBeNull();
  });

  it('test_routeBodyFields_when_checked_and_rate_empty_should_still_include_route', () => {
    const expected = { trasa: 'gpw-18.09.26-01', stawkaTrasy: '' };
    expect(routeBodyFields(true, ' gpw-18.09.26-01 ', '  ')).toEqual(expected);
    expect(vm.routeBodyFields(true, ' gpw-18.09.26-01 ', '  ')).toEqual(expected);
  });

  it('test_routeBodyFields_when_checked_and_rate_zero_should_keep_zero', () => {
    const expected = { trasa: 'gpw-18.09.26-01', stawkaTrasy: '0' };
    expect(routeBodyFields(true, 'gpw-18.09.26-01', '0')).toEqual(expected);
    expect(vm.routeBodyFields(true, 'gpw-18.09.26-01', '0')).toEqual(expected);
  });

  it('test_routeNameToShow_when_session_has_name_should_not_bump_number', () => {
    const input: RouteNameShowInput = {
      sessionLastName: 'gpw-18.09.26-01',
      proposal: 'gpw-18.09.26-02',
      currentInput: '',
      inputTouched: false,
    };
    expect(routeNameToShow(input)).toBe('gpw-18.09.26-01');
    expect(vm.routeNameToShow(input)).toBe('gpw-18.09.26-01');
  });

  it('test_routeNameToShow_when_user_types_existing_name_should_keep_it', () => {
    const input: RouteNameShowInput = {
      sessionLastName: 'gpw-18.09.26-01',
      proposal: 'gpw-19.09.26-01',
      currentInput: 'juz-jest-01',
      inputTouched: true,
    };
    expect(routeNameToShow(input)).toBe('juz-jest-01');
    expect(vm.routeNameToShow(input)).toBe('juz-jest-01');
  });

  it('test_routeNameToShow_when_no_session_should_use_proposal', () => {
    const input: RouteNameShowInput = {
      sessionLastName: '',
      proposal: 'gpw-18.09.26-01',
      currentInput: '',
      inputTouched: false,
    };
    expect(routeNameToShow(input)).toBe('gpw-18.09.26-01');
    expect(vm.routeNameToShow(input)).toBe('gpw-18.09.26-01');
  });

  it('test_routeNameRememberedAfterSave_when_save_succeeds_should_become_session_name', () => {
    expect(routeNameRememberedAfterSave(' juz-jest-01 ')).toBe('juz-jest-01');
    expect(vm.routeNameRememberedAfterSave(' juz-jest-01 ')).toBe('juz-jest-01');
    expect(routeNameRememberedAfterSave('   ')).toBe('');
    expect(vm.routeNameRememberedAfterSave('   ')).toBe('');
  });

  it('test_routeRateFromLookup_when_name_known_should_keep_rate_including_zero', () => {
    expect(routeRateFromLookup('150')).toBe('150');
    expect(vm.routeRateFromLookup('150')).toBe('150');
    expect(routeRateFromLookup(0)).toBe('0');
    expect(vm.routeRateFromLookup(0)).toBe('0');
    expect(routeRateFromLookup(null)).toBe('');
    expect(vm.routeRateFromLookup(null)).toBe('');
    expect(routeRateFromLookup(undefined)).toBe('');
    expect(vm.routeRateFromLookup(undefined)).toBe('');
  });

  it('test_routeRateToKeep_when_lookup_empty_or_user_edited_should_keep_current', () => {
    expect(routeRateToKeep('150', '', false)).toBe('150');
    expect(vm.routeRateToKeep('150', '', false)).toBe('150');
    expect(routeRateToKeep('150', null, false)).toBe('150');
    expect(vm.routeRateToKeep('150', null, false)).toBe('150');
    expect(routeRateToKeep('200', '80', true)).toBe('200');
    expect(vm.routeRateToKeep('200', '80', true)).toBe('200');
    expect(routeRateToKeep('', '80', false)).toBe('80');
    expect(vm.routeRateToKeep('', '80', false)).toBe('80');
    expect(routeRateToKeep('150', 0, false)).toBe('0');
    expect(vm.routeRateToKeep('150', 0, false)).toBe('0');
  });

  it('test_routeRateFromSession_when_same_name_and_empty_field_should_fill_remembered_rate', () => {
    const name = 'GPW Iława-22.09.26-01';
    expect(routeRateFromSession(name, '', name, '150')).toBe('150');
    expect(vm.routeRateFromSession(name, '', name, '150')).toBe('150');
    expect(routeRateFromSession(name, '200', name, '150')).toBe('200');
    expect(vm.routeRateFromSession(name, '200', name, '150')).toBe('200');
    expect(routeRateFromSession('inna', '', name, '150')).toBe('');
    expect(vm.routeRateFromSession('inna', '', name, '150')).toBe('');
    expect(routeRateFromSession(name, '', name, '   ')).toBe('');
    expect(vm.routeRateFromSession(name, '', name, '   ')).toBe('');
  });

  it('test_routeRateConflictsWithExisting_when_rate_differs_should_require_a_choice', () => {
    expect(routeRateConflictsWithExisting('Papirus-21.09.26-01', '1010', '750')).toBe(true);
    expect(vm.routeRateConflictsWithExisting('Papirus-21.09.26-01', '1010', '750')).toBe(true);
    expect(routeRateConflictsWithExisting('Papirus-21.09.26-01', '750', '750')).toBe(false);
    expect(vm.routeRateConflictsWithExisting('Papirus-21.09.26-01', '750', '750')).toBe(false);
    expect(routeRateConflictsWithExisting('Papirus-21.09.26-01', '1010', '')).toBe(false);
    expect(vm.routeRateConflictsWithExisting('Papirus-21.09.26-01', '1010', '')).toBe(false);
    expect(routeRateConflictsWithExisting('Papirus-21.09.26-01', '', '750')).toBe(false);
    expect(vm.routeRateConflictsWithExisting('Papirus-21.09.26-01', '', '750')).toBe(false);
    expect(routeRateConflictsWithExisting('Papirus-21.09.26-01', '0', '750')).toBe(true);
    expect(vm.routeRateConflictsWithExisting('Papirus-21.09.26-01', '0', '750')).toBe(true);
    expect(routeRateConflictsWithExisting('  ', '1010', '750')).toBe(false);
    expect(vm.routeRateConflictsWithExisting('  ', '1010', '750')).toBe(false);
  });

  it('test_assignRouteBody_when_no_route_should_leave_payload_without_route_keys', () => {
    const payload = { komentarz2: 'x' };
    expect(assignRouteBody(payload, null)).toEqual({ komentarz2: 'x' });
    expect(payload).toEqual({ komentarz2: 'x' });
    const vmPayload = { komentarz2: 'x' };
    expect(vm.assignRouteBody(vmPayload, null)).toEqual({ komentarz2: 'x' });
    expect(vmPayload).toEqual({ komentarz2: 'x' });
  });

  it('test_assignRouteBody_when_route_checked_should_set_columns_12_and_13', () => {
    const fields = { trasa: 'gpw-18.09.26-01', stawkaTrasy: '' };
    const payload: Record<string, unknown> = { numer: '' };
    assignRouteBody(payload, fields);
    expect(payload).toEqual({ numer: '', trasa: 'gpw-18.09.26-01', stawkaTrasy: '' });
    const vmPayload: Record<string, unknown> = { numer: '' };
    vm.assignRouteBody(vmPayload, fields);
    expect(vmPayload).toEqual({ numer: '', trasa: 'gpw-18.09.26-01', stawkaTrasy: '' });
  });

  it('test_routeProtocolBrowserScript_should_not_keep_session_or_local_storage', () => {
    const script = routeProtocolBrowserScript();
    expect(script).toContain('function routeBodyFields');
    expect(script).toContain('function routeNameToShow');
    expect(script).toContain('function routeRateConflictsWithExisting');
    expect(script).not.toContain('localStorage');
    expect(script).not.toContain('lastRouteName');
  });

  it('test_routeProtocolBrowserScript_when_built_should_not_inject_esbuild_keepNames', () => {
    // Regresja jak przy namesBlockingNewRoute: `__name` nie istnieje w przeglądarce.
    const script = routeProtocolBrowserScript();
    expect(script).not.toMatch(/__name\s*\(/);
    expect(() => browserFns()).not.toThrow();
  });
});
