import type { ReactNode } from "react";
import { getMockupProfile } from "../mockups";

interface PhoneMockupProps {
  mockupId: string;
  children: ReactNode;
  /** Lay out a landscape phone: rotate only the bezel art, keep the screen upright. */
  landscape?: boolean;
}

export function PhoneMockup({ mockupId, children, landscape = false }: PhoneMockupProps) {
  const profile = getMockupProfile(mockupId);
  const { screen } = profile;

  // Landscape screen hole: near-full inset; portrait % remap is unreliable once the bezel is spun.
  const screenStyle = landscape
    ? {
        left: "1.8%",
        top: "2.8%",
        width: "96.4%",
        height: "94.4%",
        borderRadius: profile.screenRadius,
        clipPath: `inset(0 round ${profile.screenRadius})`,
      }
    : {
        left: `${screen.left}%`,
        top: `${screen.top}%`,
        width: `${screen.width}%`,
        height: `${screen.height}%`,
        borderRadius: profile.screenRadius,
        clipPath: `inset(0 round ${profile.screenRadius})`,
      };

  return (
    <div
      className={landscape ? "phone-mockup phone-mockup--landscape" : "phone-mockup"}
      data-mockup={mockupId}
    >
      <div className="phone-mockup__inner">
        <div className="phone-mockup__screen" style={screenStyle}>
          {children}
        </div>
        <img className="phone-mockup__frame" src={profile.frame} alt="" draggable={false} />
      </div>
    </div>
  );
}
