import { useEffect, useRef, type RefObject } from "react";

/**
 * Open an HTMLDialogElement once with showModal().
 * Esc and backdrop click dismiss without saving (caller owns discard).
 * onClose is read from a ref so parent re-renders (e.g. busy flag) do not
 * re-call showModal() — that throws and can leave a stuck ::backdrop.
 */
export function useDialogModal(
  dialogRef: RefObject<HTMLDialogElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    const onCancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };

    // Clicks on the dimmed ::backdrop hit the <dialog> itself; panel clicks
    // hit descendants and must not close.
    const onBackdropClick = (event: MouseEvent) => {
      if (event.target === dialog) {
        onCloseRef.current();
      }
    };

    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("click", onBackdropClick);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("click", onBackdropClick);
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [dialogRef]);
}
