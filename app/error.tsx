'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black text-white p-4">
      <h2 className="text-2xl font-bold mb-4 text-red-500">Something went wrong!</h2>
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
  )
}
