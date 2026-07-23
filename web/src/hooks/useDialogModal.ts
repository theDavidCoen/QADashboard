import { useEffect, useRef, type RefObject } from "react";

/**
 * Open an HTMLDialogElement once with showModal().
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

    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [dialogRef]);
}
