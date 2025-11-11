(define-constant ERR-NOT-AUTHORIZED u3000)
(define-constant ERR-INVALID-BUDGET-ID u3001)
(define-constant ERR-BUDGET-NOT-FOUND u3002)
(define-constant ERR-AMOUNT-ZERO u3003)
(define-constant ERR-INSUFFICIENT-BALANCE u3004)
(define-constant ERR-INVALID-PURPOSE u3005)
(define-constant ERR-INVALID-RECIPIENT u3006)
(define-constant ERR-TOKEN-BURN-FAILED u3007)
(define-constant ERR-STX-TRANSFER-FAILED u3008)
(define-constant ERR-TX-ID-GENERATION-FAILED u3009)
(define-constant ERR-INVALID-METADATA u3010)
(define-constant ERR-EXPENDITURE-EXISTS u3011)
(define-constant ERR-QUERY-RANGE-INVALID u3012)

(define-data-var next-expenditure-id uint u0)

(define-map expenditures
  { budget-id: uint, exp-id: uint }
  {
    amount: uint,
    recipient: principal,
    purpose: (string-ascii 128),
    timestamp: uint,
    tx-sender: principal,
    metadata: (optional (buff 256)),
    status: (string-ascii 20)
  }
)

(define-map expenditure-index-by-tx
  (buff 32)
  { budget-id: uint, exp-id: uint }
)

(define-map budget-total-spent uint uint)
(define-map budget-expenditure-count uint uint)

(define-read-only (get-expenditure (budget-id uint) (exp-id uint))
  (map-get? expenditures { budget-id: budget-id, exp-id: exp-id })
)

(define-read-only (get-expenditure-by-tx (tx-hash (buff 32)))
  (match (map-get? expenditure-index-by-tx tx-hash)
    index (some (get-expenditure (get budget-id index) (get exp-id index)))
    none
  )
)

(define-read-only (get-budget-total-spent (budget-id uint))
  (default-to u0 (map-get? budget-total-spent budget-id))
)

(define-read-only (get-budget-expenditure-count (budget-id uint))
  (default-to u0 (map-get? budget-expenditure-count budget-id))
)

(define-read-only (get-expenditures-in-range
  (budget-id uint)
  (start-id uint)
  (limit uint)
)
  (let (
    (count (get-budget-expenditure-count budget-id))
    (end-id (if (> (+ start-id limit) count) count (+ start-id limit)))
  )
    (asserts! (>= end-id start-id) (ok (list)))
    (ok (filter
      (lambda (id) (is-some (get-expenditure budget-id id)))
      (range start-id end-id)
    ))
  )
)

(define-private (validate-budget-id (budget-id uint))
  (if (> budget-id u0) (ok true) (err ERR-INVALID-BUDGET-ID))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0) (ok true) (err ERR-AMOUNT-ZERO))
)

(define-private (validate-purpose (purpose (string-ascii 128)))
  (if (and (> (len purpose) u0) (<= (len purpose) u128))
    (ok true)
    (err ERR-INVALID-PURPOSE)
  )
)

(define-private (validate-recipient (recipient principal))
  (if (not (is-eq recipient tx-sender))
    (ok true)
    (err ERR-INVALID-RECIPIENT)
  )
)

(define-private (validate-metadata (metadata (optional (buff 256))))
  (match metadata
    data (if (<= (len data) u256) (ok true) (err ERR-INVALID-METADATA))
    (ok true)
  )
)

(define-private (generate-tx-id)
  (let (
    (raw (concat
      (unwrap-panic (to-consensus-buff? tx-sender))
      (unwrap-panic (to-consensus-buff? block-height))
    ))
  )
    (some (sha256 raw))
  )
)

(define-public (record-expenditure
  (budget-id uint)
  (amount uint)
  (recipient principal)
  (purpose (string-ascii 128))
  (metadata (optional (buff 256)))
)
  (let (
    (exp-id (var-get next-expenditure-id))
    (tx-hash (unwrap! (generate-tx-id) (err ERR-TX-ID-GENERATION-FAILED)))
    (current-spent (get-budget-total-spent budget-id))
  )
    (try! (validate-budget-id budget-id))
    (try! (validate-amount amount))
    (try! (validate-purpose purpose))
    (try! (validate-recipient recipient))
    (try! (validate-metadata metadata))
    (asserts! (is-none (map-get? expenditure-index-by-tx tx-hash)) (err ERR-EXPENDITURE-EXISTS))
    (try! (contract-call? .micro-token burn amount tx-sender))
    (try! (as-contract (stx-transfer? amount tx-sender recipient)))
    (map-set expenditures
      { budget-id: budget-id, exp-id: exp-id }
      {
        amount: amount,
        recipient: recipient,
        purpose: purpose,
        timestamp: block-height,
        tx-sender: tx-sender,
        metadata: metadata,
        status: "completed"
      }
    )
    (map-set expenditure-index-by-tx tx-hash { budget-id: budget-id, exp-id: exp-id })
    (map-set budget-total-spent budget-id (+ current-spent amount))
    (map-set budget-expenditure-count budget-id (+ (get-budget-expenditure-count budget-id) u1))
    (var-set next-expenditure-id (+ exp-id u1))
    (print {
      event: "expenditure-recorded",
      budget-id: budget-id,
      exp-id: exp-id,
      amount: amount,
      recipient: recipient,
      tx-hash: tx-hash
    })
    (ok exp-id)
  )
)

(define-public (void-expenditure (budget-id uint) (exp-id uint) (reason (string-ascii 128)))
  (let (
    (exp (unwrap! (get-expenditure budget-id exp-id) (err ERR-BUDGET-NOT-FOUND)))
  )
    (asserts! (is-eq (get tx-sender exp) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status exp) "completed") (err ERR-INVALID-STATUS))
    (map-set expenditures
      { budget-id: budget-id, exp-id: exp-id }
      (merge exp { status: "voided", metadata: (some (unwrap-panic (to-consensus-buff? reason))) })
    )
    (map-set budget-total-spent budget-id (- (get-budget-total-spent budget-id) (get amount exp)))
    (print { event: "expenditure-voided", budget-id: budget-id, exp-id: exp-id, reason: reason })
    (ok true)
  )
)

(define-read-only (search-expenditures-by-purpose
  (budget-id uint)
  (purpose-substring (string-ascii 32))
)
  (let (
    (count (get-budget-expenditure-count budget-id))
  )
    (filter
      (lambda (id)
        (match (get-expenditure budget-id id)
          exp (and
            (is-eq (get status exp) "completed")
            (string-contains? (get purpose exp) purpose-substring)
          )
          false
        )
      )
      (range u0 count)
    )
  )
)

(define-read-only (get-expenditure-trail (budget-id uint))
  (let (
    (count (get-budget-expenditure-count budget-id))
  )
    (fold
      (lambda (acc id)
        (match (get-expenditure budget-id id)
          exp (append acc {
            id: id,
            amount: (get amount exp),
            recipient: (get recipient exp),
            purpose: (get purpose exp),
            timestamp: (get timestamp exp),
            status: (get status exp)
          })
          acc
        )
      )
      (list)
      (range u0 count)
    )
  )
)