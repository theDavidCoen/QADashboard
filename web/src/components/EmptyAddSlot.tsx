interface EmptyAddSlotProps {
  onClick: () => void;
  ariaLabel?: string;
}

/** USB-A plug + cable into phone (provided empty-state artwork). */
function UsbPhoneIcon() {
  return (
    <svg
      className="empty-add__icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="90 75 320 390"
      aria-hidden="true"
    >
      {/* USB connector metal plug */}
      <rect
        x="108"
        y="145"
        width="64"
        height="55"
        rx="3"
        ry="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="12"
      />
      {/* Two square holes in USB shield */}
      <rect x="123" y="166" width="10" height="10" fill="currentColor" rx="1" />
      <rect x="147" y="166" width="10" height="10" fill="currentColor" rx="1" />
      {/* USB connector body */}
      <rect x="96" y="200" width="88" height="100" rx="16" ry="16" fill="currentColor" />
      {/* Strain relief */}
      <rect x="124" y="300" width="32" height="24" rx="4" ry="4" fill="currentColor" />
      {/* Smartphone */}
      <rect
        x="235"
        y="85"
        width="160"
        height="270"
        rx="28"
        ry="28"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
      />
      {/* Home bar */}
      <rect x="288" y="318" width="54" height="12" rx="6" ry="6" fill="currentColor" />
      {/* Phone port connector */}
      <rect x="299" y="355" width="32" height="28" rx="4" ry="4" fill="currentColor" />
      {/* U-shaped cable */}
      <path
        d="M 140,320
           L 140,380
           A 65,65 0 0,0 205,445
           L 250,445
           A 65,65 0 0,0 315,380
           L 315,375"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyAddSlot({ onClick, ariaLabel = "Add device via USB" }: EmptyAddSlotProps) {
  return (
    <button
      type="button"
      className="device-slot device-slot--empty device-slot--action empty-add"
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <div className="device-slot__header device-slot__header--spacer" aria-hidden="true" />
      <div className="empty-body empty-body--add">
        <div className="empty-add__inner">
          <UsbPhoneIcon />
          <h3 className="empty-add__title">Add device (USB)</h3>
          <p className="empty-add__hint">
            Connect device via USB — ensure
            <br />
            USB Debugging is enabled (Android) or
            <br />
            device is trusted (iOS)
          </p>
        </div>
      </div>
    </button>
  );
}
