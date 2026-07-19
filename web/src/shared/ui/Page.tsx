import type { ReactNode } from 'react';

type PageProps = {
  title: string;
  toolbar?: ReactNode;
  children: ReactNode;
};

export function Page({ title, toolbar, children }: PageProps) {
  return (
    <div className="app">
      <div className="form-chrome">
        <div className="form-chrome-bar">
          <h2 className="form-chrome-title">{title}</h2>
          <div className="form-chrome-actions">{toolbar}</div>
        </div>
        <div className="form-chrome-body">{children}</div>
      </div>
    </div>
  );
}
