import type { ReactNode } from "react";
import { getMockupProfile } from "../mockups";

interface PhoneMockupProps {
  mockupId: string;
  children: ReactNode;
}

export function PhoneMockup({ mockupId, children }: PhoneMockupProps) {
  const profile = getMockupProfile(mockupId);
  const { screen } = profile;

  return (
    <div className="phone-mockup" data-mockup={mockupId}>
      <div className="phone-mockup__inner">
        <div
          className="phone-mockup__screen"
          style={{
            left: `${screen.left}%`,
            top: `${screen.top}%`,
            width: `${screen.width}%`,
            height: `${screen.height}%`,
            borderRadius: profile.screenRadius,
            clipPath: `inset(0 round ${profile.screenRadius})`,
          }}
        >
          {children}
        </div>
        <img
          className="phone-mockup__frame"
          src={profile.frame}
          alt=""
          draggable={false}
        />
      </div>
    </div>
  );
}
