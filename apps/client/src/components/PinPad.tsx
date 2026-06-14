import { useCallback, useEffect, useMemo, useRef } from 'react';
import { PIN_LENGTH } from '../utils/pin-lock';

type PinPadProps = {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (value: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  disabled?: boolean;
};

export function PinPad({ value, onChange, onComplete, autoFocus = true, invalid = false, disabled = false }: PinPadProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const slots = useMemo(() => Array.from({ length: PIN_LENGTH }, (_, i) => i), []);

  useEffect(() => {
    if (!autoFocus) return;
    const firstEmpty = Math.min(value.length, PIN_LENGTH - 1);
    inputRefs.current[firstEmpty]?.focus();
  }, [autoFocus, value.length]);

  const setDigit = useCallback((index: number, digit: string) => {
    const next = (value.padEnd(PIN_LENGTH, ' ').split('').map((c, i) => (i === index ? digit : c)).join('')).replace(/ /g, '');
    const trimmed = next.slice(0, PIN_LENGTH);
    onChange(trimmed);
    return trimmed;
  }, [onChange, value]);

  const handleChange = useCallback((index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) return;

    if (cleaned.length > 1) {
      const next = (value + cleaned).replace(/\D/g, '').slice(0, PIN_LENGTH);
      onChange(next);
      const focusIndex = Math.min(next.length, PIN_LENGTH - 1);
      inputRefs.current[focusIndex]?.focus();
      if (next.length === PIN_LENGTH) onComplete?.(next);
      return;
    }

    const digit = cleaned[0];
    const updated = setDigit(index, digit);
    if (index < PIN_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (updated.length === PIN_LENGTH) {
      onComplete?.(updated);
    }
  }, [onChange, onComplete, setDigit, value]);

  const handleKeyDown = useCallback((index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        const next = value.slice(0, index) + value.slice(index + 1);
        onChange(next);
        inputRefs.current[Math.max(0, index)]?.focus();
      } else if (index > 0) {
        const next = value.slice(0, index - 1) + value.slice(index);
        onChange(next);
        inputRefs.current[index - 1]?.focus();
      }
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputRefs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      event.preventDefault();
      inputRefs.current[index + 1]?.focus();
    }
  }, [onChange, value]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    const focusIndex = Math.min(pasted.length, PIN_LENGTH - 1);
    inputRefs.current[focusIndex]?.focus();
    if (pasted.length === PIN_LENGTH) onComplete?.(pasted);
  }, [onChange, onComplete]);

  return (
    <div className={invalid ? 'pin-pad invalid' : 'pin-pad'}>
      {slots.map((index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          className="pin-pad-input"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[index] ?? ''}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.currentTarget.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}
