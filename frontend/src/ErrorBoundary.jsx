import { Component } from 'react'

/**
 * Top-level boundary for unexpected React rendering errors only.
 * Handled failures (a failed request, an Apps Script error response) are
 * reported inside the cards and never reach this component.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    console.error('Unexpected rendering error:', error, info)
  }

  render() {
    if (!this.state.failed) {
      return this.props.children
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="max-w-md rounded-lg bg-white p-6 text-center shadow-md">
          <h1 className="text-base font-semibold text-gray-900">
            Something went wrong.
          </h1>
          <p className="mt-2 text-sm text-gray-600">Please refresh the page.</p>
          <p className="mt-1 text-sm text-gray-600">
            If the problem continues, check the browser console.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Reload Page
          </button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
