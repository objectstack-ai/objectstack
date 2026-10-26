/**
 * A navigation announces nothing unless its action declares the copy
 * (objectui#12755).
 *
 * `type: 'url'` (and its `navigation` alias, and `type: 'form'`) only change
 * the route. Their success used to reach the generic `completedSuccessfully`
 * toast, so a button that merely opened a page told the user an operation had
 * completed (objectstack-ai/cloud#2909). A declared `successMessage` still
 * shows, and an action that writes keeps its toast.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ActionRunner } from '../ActionRunner';

describe('ActionRunner: a navigation raises no success toast unless it declares one (objectui#12755)', () => {
  let runner: ActionRunner;
  let toast: Mock<(message: string, options?: unknown) => void>;
  let navigate: Mock<(url: string, options?: unknown) => void>;

  beforeEach(() => {
    runner = new ActionRunner({ record: { id: 7 } });
    toast = vi.fn();
    navigate = vi.fn();
    runner.setToastHandler(toast);
    runner.setNavigationHandler(navigate);
  });

  it('a bare url action navigates and stays silent', async () => {
    const result = await runner.execute({ type: 'url', target: '/apps/cloud/plans' });

    expect(navigate).toHaveBeenCalledWith('/apps/cloud/plans', expect.objectContaining({ external: false }));
    expect(result.success).toBe(true);
    expect(toast).not.toHaveBeenCalled();
  });

  it('a bare navigation-alias action and a form action stay silent too', async () => {
    await runner.execute({ type: 'navigation', to: '/apps/cloud/members' });
    await runner.execute({ type: 'form', target: 'member_invite' });

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(toast).not.toHaveBeenCalled();
  });

  it('a url action that declares successMessage toasts that copy', async () => {
    await runner.execute({ type: 'url', target: '/apps/cloud/plans', successMessage: 'Opened plans' });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Opened plans', expect.objectContaining({ type: 'success' }));
  });

  it('a refused navigation still reports its error', async () => {
    const result = await runner.execute({ type: 'url', target: 'javascript:alert(1)' });

    expect(result.success).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ type: 'error' }));
  });

  it('CONTROL: an action that writes keeps its generic success toast', async () => {
    runner.registerHandler('api', async () => ({ success: true, data: { id: 7 } }));

    await runner.execute({ type: 'api', target: 'invite_member' });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ type: 'success' }));
  });
});
