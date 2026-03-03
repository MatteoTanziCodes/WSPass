"use client";

import { useFormStatus } from "react-dom";

type FormSubmitButtonProps = {
  idleLabel: string;
  pendingLabel?: string;
  className: string;
  disabled?: boolean;
};

export function FormSubmitButton(props: FormSubmitButtonProps) {
  const { idleLabel, pendingLabel = "Working...", className, disabled = false } = props;
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;

  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={className}
    >
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
