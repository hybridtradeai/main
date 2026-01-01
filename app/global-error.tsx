'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body className="bg-black text-white">
        <div className="flex min-h-screen flex-col items-center justify-center p-4">
          <h2 className="text-2xl font-bold mb-4 text-red-500">Global Application Error</h2>
          <p className="mb-4">The application crashed critically.</p>
          <pre className="bg-gray-900 p-4 rounded mb-4 max-w-lg overflow-auto text-sm text-gray-300">
            {error.message}
          </pre>
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
