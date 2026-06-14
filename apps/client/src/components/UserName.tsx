import type { CSSProperties } from 'react';
import type { PublicUser } from '../api/types';
import { nameStyleClass, nameStyleToCss } from '../utils/name-style';

type UserNameProps = {
  user: Pick<PublicUser, 'nickname' | 'nameStyle'>;
  as?: 'span' | 'strong' | 'h3' | 'h1';
  className?: string;
  style?: CSSProperties;
};

// Renders a user's nickname with their saved name style (font, effect, colour)
// applied. Use this everywhere a nickname is shown so styling stays consistent.
export function UserName({ user, as = 'span', className, style }: UserNameProps) {
  const Tag = as;
  const fxClass = nameStyleClass(user.nameStyle);
  const merged = [className, fxClass].filter(Boolean).join(' ');
  return (
    <Tag className={merged || undefined} style={{ ...nameStyleToCss(user.nameStyle), ...style }}>
      {user.nickname}
    </Tag>
  );
}
