export default function DashboardLoading() {
  return (
    <div className="space-y-5" role="status" aria-label="جارٍ تحميل الصفحة">
      <div className="space-y-2">
        <div className="skeleton h-7 w-44 rounded" />
        <div className="skeleton h-4 w-72 max-w-full rounded" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="card p-4 space-y-3">
            <div className="skeleton h-3 w-20 rounded" />
            <div className="skeleton h-7 w-28 rounded" />
          </div>
        ))}
      </div>
      <div className="card p-4 space-y-4">
        <div className="skeleton h-10 w-full rounded" />
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="skeleton h-12 w-full rounded" />
        ))}
      </div>
    </div>
  )
}
