// This example illustrates source analysis; it is not a standalone React app.
declare const selected: boolean;
declare function cn(...values: unknown[]): string;

export const Example = () => (
  <article
    dir="rtl"
    className={cn('md:ml-4 text-right', selected && 'border-l-2', { 'pr-3': selected })}
    style={{ marginLeft: 12, paddingRight: 8 }}
  >
    <h2>نمونهٔ فارسی با React</h2>
    <p className="ms-2 text-start">کلاس‌های منطقی پیشنهاد اصلاح ندارند.</p>
    <span className="rtl:ml-4 ltr:mr-4">جهت‌دهی عمدی</span>
  </article>
);
