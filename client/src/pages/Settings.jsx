import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import Spinner from '@/components/ui/Spinner';
import ThemeSwitch from '@/components/ui/ThemeSwitch';
import { useToast } from '@/contexts/ToastContext';
import { getPreferences, updatePreferences } from '@/services/users.service';
import Page from '@/components/layout/Page';

// The same three states the server constrains (migration 015). Mirrored here so
// the control can be rendered from the list rather than hardcoded three times,
// and so the two cannot drift silently — a value the server would reject is not
// offered.
const LEVELS = [
  { value: 'all', label: 'Everything', description: 'Mentions, messages, files and invites.' },
  { value: 'mentions', label: 'Mentions only', description: 'Only when somebody @mentions you.' },
  { value: 'none', label: 'Nothing', description: 'Record everything, notify you about nothing.' },
];

// One row per notification type, matching notification.service's allowlist. The
// server validates `muted` keys by name and answers 400 for anything else, so
// this list and that one have to agree.
const TYPES = [
  { value: 'mention', label: 'Mentions' },
  { value: 'new_message', label: 'New messages' },
  { value: 'file_uploaded', label: 'Uploaded files' },
  { value: 'room_invite', label: 'Room invites' },
];

/**
 * Settings — appearance and notifications.
 *
 * Phase 7 made the notification section real. Before this it was an EmptyState
 * promising "notification preferences are being built", which was true only in
 * the sense that nothing stored a choice; the table, the endpoints and this
 * screen arrived together.
 *
 * Activity level is the coarse control and the per-type list is the fine one, and
 * they interact: `none` silences everything regardless of the type list, which is
 * why the type rows go dim rather than disappearing — the saved state stays
 * visible and editable, so switching back to `all` restores what you had chosen
 * rather than resetting it.
 */
export default function Settings() {
  const { setRoomHeader } = useOutletContext();
  const { toast } = useToast();

  const [preferences, setPreferences] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    setRoomHeader('Settings');
    return () => setRoomHeader(null);
  }, [setRoomHeader]);

  useEffect(() => {
    let active = true;
    getPreferences()
      .then((value) => active && setPreferences(value))
      .catch(() => active && setPreferences(null))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function save(updates, key) {
    setSavingKey(key);
    // Optimistic, then reconciled with the server's answer. The response is the
    // truth: PATCH merges with what is stored rather than replacing it, so the
    // value echoed back is the whole object and not just the field sent.
    const previous = preferences;
    setPreferences((prev) => ({ ...prev, ...updates }));
    try {
      const saved = await updatePreferences(updates);
      setPreferences(saved);
    } catch (err) {
      setPreferences(previous);
      toast({
        title: 'Could not save',
        description: err.response?.data?.message || 'Your preference was not saved.',
        tone: 'error',
      });
    } finally {
      setSavingKey(null);
    }
  }

  if (isLoading) return <Spinner fullPage label="Loading settings" />;

  const level = preferences?.activity_level ?? 'all';
  const muted = preferences?.muted ?? {};
  const silenced = level === 'none';

  return (
      <Page width="form">
      <h1 className="text-h1 text-ink">Settings</h1>
      <p className="mt-2 text-body leading-relaxed text-muted">
        How Conclave looks, and when it interrupts you.
      </p>

      <section className="mt-8 rounded-xl border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">Appearance</h2>
        <p className="mt-2 max-w-xl text-body leading-relaxed text-muted">
          Conclave follows your system appearance by default. Choosing Light or Dark overrides it
          for this device only; choosing System hands control back and keeps tracking as your
          system changes.
        </p>
        <div className="mt-5">
          <ThemeSwitch />
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-surface p-6">
        <h2 className="text-h2 text-ink">Notifications</h2>
        <p className="mt-2 max-w-xl text-body leading-relaxed text-muted">
          Conclave records everything you are shown either way. These settings decide what interrupts
          you, not what the workspace keeps.
        </p>

        <fieldset className="mt-5">
          <legend className="text-label font-semibold text-ink">Notify me about</legend>
          <div className="mt-3 space-y-2">
            {LEVELS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  level === option.value
                    ? 'border-brand bg-brand-soft'
                    : 'border-line hover:bg-canvas'
                }`}
              >
                <input
                  type="radio"
                  name="activity_level"
                  value={option.value}
                  checked={level === option.value}
                  disabled={savingKey === `level-${option.value}`}
                  onChange={() => save({ activity_level: option.value }, `level-${option.value}`)}
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                />
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{option.label}</span>
                  <span className="mt-0.5 block text-metadata text-muted">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-7">
          <legend className="text-label font-semibold text-ink">Per-type overrides</legend>
          <p className="mt-1 text-metadata text-muted">
            {silenced
              ? 'These are saved but not delivered while “Nothing” is selected.'
              : 'Switch off any kind you would rather not be interrupted by.'}
          </p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {TYPES.map((type) => {
              const isMuted = Boolean(muted[type.value]);
              return (
                <li key={type.value} className="flex items-center gap-3 bg-surface px-3 py-2.5">
                  <label
                    className={`flex flex-1 items-center gap-3 text-body ${
                      silenced ? 'text-muted' : 'cursor-pointer text-ink'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!isMuted}
                      disabled={silenced || savingKey === `muted-${type.value}`}
                      onChange={() =>
                        save(
                          { muted: { ...muted, [type.value]: !isMuted } },
                          `muted-${type.value}`,
                        )
                      }
                      className="h-4 w-4 shrink-0 rounded border-line text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    />
                    {type.label}
                  </label>
                  {isMuted && !silenced && (
                    <span className="shrink-0 text-metadata text-muted">Off</span>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      </section>
      </Page>
  );
}