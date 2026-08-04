import type { CSSProperties, ReactNode } from "react";
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
  // Keep elliptical radii (`15.5% / 7.15%`) for border-radius. For clip-path,
  // some WebViews mishandle the slash form — use the horizontal token only there.
  const radiusBorder = profile.screenRadius;
  const radiusClip = profile.screenRadius.split("/")[0].trim();

  // Landscape screen hole: near-full inset; portrait % remap is unreliable once the bezel is spun.
  const screenStyle: CSSProperties = landscape
    ? {
        left: "1.8%",
        top: "2.8%",
        width: "96.4%",
        height: "94.4%",
        borderRadius: radiusBorder,
        clipPath: `inset(0 round ${radiusClip})`,
      }
    : {
        left: `${screen.left}%`,
        top: `${screen.top}%`,
        width: `${screen.width}%`,
        height: `${screen.height}%`,
        borderRadius: radiusBorder,
        ...(profile.screenMask
          ? {
              // Mask defines DI + corners. Do not add clip-path with a single-token %
              // radius — that over-rounds the vertical axis (ghost oval on iPhone).
              WebkitMaskImage: `url(${profile.screenMask})`,
              maskImage: `url(${profile.screenMask})`,
              WebkitMaskSize: "100% 100%",
              maskSize: "100% 100%",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }
          : {
              clipPath: `inset(0 round ${radiusClip})`,
            }),
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
