// components/VerifiedBadge.tsx
// White verified badge with dark checkmark (matches website)

import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
};

export default function VerifiedBadge({ size = 14 }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ marginLeft: 4 }}
    >
      {/* White star/badge shape */}
      <Path
        d="M12 1.8l2.2 1.6 2.8-.4 1.1 2.6 2.6 1.1-.4 2.8L22.2 12l-1.9 2.3.4 2.8-2.6 1.1-1.1 2.6-2.8-.4L12 22.2l-2.2-1.8-2.8.4-1.1-2.6-2.6-1.1.4-2.8L1.8 12l1.9-2.3-.4-2.8 2.6-1.1 1.1-2.6 2.8.4L12 1.8Z"
        fill="#FFFFFF"
      />
      {/* Dark checkmark inside */}
      <Path
        d="M7.6 12.1L10.4 14.9L16.6 8.7"
        fill="none"
        stroke="#111827"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
