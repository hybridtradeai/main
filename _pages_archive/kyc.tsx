import { useEffect, useState } from 'react'
import RequireAuth from '../components/RequireAuth'
import { supabase } from '../lib/supabase'
import { User as UserIcon, IdCard, Camera, CheckCircle } from 'lucide-react'
import { useI18n } from '../hooks/useI18n'

type Profile = { user_id: string; email?: string; kyc_status?: 'pending'|'approved'|'rejected'|null; kyc_level?: number; kyc_submitted_at?: string|null }

export default function KycPage() {
  const { t } = useI18n()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [level, setLevel] = useState<number>(1)
  const [fullName, setFullName] = useState('')
  const [dob, setDob] = useState('')
  const [address, setAddress] = useState('')
  const [idType, setIdType] = useState('national_id')
  const [idNumber, setIdNumber] = useState('')
  const [country, setCountry] = useState('NG')
  const [idExpiry, setIdExpiry] = useState('')
  const [idFile, setIdFile] = useState<File | null>(null)
  const [selfieNeutral, setSelfieNeutral] = useState<File | null>(null)
  const [selfieSmile, setSelfieSmile] = useState<File | null>(null)
  const [selfieLeft, setSelfieLeft] = useState<File | null>(null)
  const [selfieRight, setSelfieRight] = useState<File | null>(null)
  const [step, setStep] = useState<number>(1)
  const [cameraOn, setCameraOn] = useState(false)
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null)
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)
  const [autoCaptureRunning, setAutoCaptureRunning] = useState(false)
  const [autoCaptureStep, setAutoCaptureStep] = useState<string>('')
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)

  const countrySchemas: Record<string, { name: string; idTypes: { value: string; label: string; pattern?: RegExp }[] }> = {
    NG: { name: 'Nigeria', idTypes: [
      { value: 'national_id', label: 'National ID (NIN)', pattern: /^[0-9]{11}$/ },
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{8,}$/ },
      { value: 'voter_card', label: 'Voter Card (VIN)', pattern: /^[A-Z0-9]{10,}$/ },
    ]},
    GH: { name: 'Ghana', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'national_id', label: 'Ghana Card', pattern: /^[A-Z]{2}[0-9]{8}[0-9A-Z]?$/ },
      { value: 'voter_card', label: 'Voter ID', pattern: /^[0-9]{10,}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{6,}$/ },
    ]},
    KE: { name: 'Kenya', idTypes: [
      { value: 'national_id', label: 'National ID', pattern: /^[0-9]{5,10}$/ },
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{7,}$/ },
      { value: 'huduma', label: 'Huduma Namba', pattern: /^[0-9]{8,}$/ },
    ]},
    ZA: { name: 'South Africa', idTypes: [
      { value: 'national_id', label: 'National ID', pattern: /^[0-9]{13}$/ },
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{6,}$/ },
    ]},
    US: { name: 'United States', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{5,}$/ },
      { value: 'national_id', label: 'SSN (last 4)', pattern: /^[0-9]{4}$/ },
      { value: 'state_id', label: 'State ID', pattern: /^[A-Z0-9\\-]{5,}$/ },
    ]},
    CA: { name: 'Canada', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z]{2}[0-9]{6}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{5,}$/ },
      { value: 'national_id', label: 'Provincial ID', pattern: /^[A-Z0-9\\-]{5,}$/ },
    ]},
    GB: { name: 'United Kingdom', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[0-9]{9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9]{16}$/ },
      { value: 'brp', label: 'Biometric Residence Permit', pattern: /^[0-9]{9}$/ },
    ]},
    EU: { name: 'European Union', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'national_id', label: 'National ID', pattern: /^[A-Z0-9]{6,14}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9]{6,14}$/ },
    ]},
    IN: { name: 'India', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z]{1}[0-9]{7}$/ },
      { value: 'aadhaar', label: 'Aadhaar', pattern: /^[0-9]{12}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{8,}$/ },
      { value: 'pan', label: 'PAN', pattern: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/ },
    ]},
    AE: { name: 'United Arab Emirates', idTypes: [
      { value: 'eid', label: 'Emirates ID', pattern: /^[0-9]{3}-?[0-9]{4}-?[0-9]{7}-?[0-9]{1}$/ },
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{7,9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{5,}$/ },
    ]},
    SA: { name: 'Saudi Arabia', idTypes: [
      { value: 'iqama', label: 'Iqama/National ID', pattern: /^[0-9]{10}$/ },
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{7,9}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[0-9]{10}$/ },
    ]},
    BR: { name: 'Brazil', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{8,9}$/ },
      { value: 'cpf', label: 'CPF', pattern: /^[0-9]{11}$/ },
      { value: 'rg', label: 'RG', pattern: /^[0-9]{7,10}$/ },
      { value: 'driver_license', label: 'CNH (Driver License)', pattern: /^[0-9]{11}$/ },
    ]},
    MX: { name: 'Mexico', idTypes: [
      { value: 'passport', label: 'Passport', pattern: /^[A-Z0-9]{9}$/ },
      { value: 'ine', label: 'INE/IFE', pattern: /^[A-Z0-9]{13,18}$/ },
      { value: 'curp', label: 'CURP', pattern: /^[A-Z]{4}[0-9]{6}[A-Z]{6}[0-9]{2}$/ },
      { value: 'driver_license', label: 'Driver License', pattern: /^[A-Z0-9\\-]{6,}$/ },
    ]},
    OTHER: { name: 'Other', idTypes: [
      { value: 'passport', label: 'Passport' },
      { value: 'national_id', label: 'National ID' },
      { value: 'driver_license', label: 'Driver License' },
    ]},
  }

  async function load() {
    try {
      const { data: user } = await supabase.auth.getUser()
      const uid = user.user?.id
      if (!uid) return
      const { data } = await supabase
        .from('profiles')
        .select('user_id,email,kyc_status,kyc_level,kyc_submitted_at')
        .eq('user_id', uid)
        .maybeSingle()
      setProfile((data as any) || null)
      if (typeof (data as any)?.kyc_level === 'number') setLevel(Number((data as any).kyc_level))
    } catch {}
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    let localStream: MediaStream | null = null
    if (!cameraOn) {
      try {
        videoStream?.getTracks()?.forEach((t) => t.stop())
      } catch {}
      setVideoStream(null)
      return
    }
    const v = document.querySelector('#kyc-selfie-video') as HTMLVideoElement | null
    setVideoEl(v)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        localStream = stream
        setVideoStream(stream)
        if (v) {
          v.srcObject = stream
          v.play().catch(() => {})
        }
      })
      .catch(() => {
        setCameraOn(false)
      })
    return () => {
      try {
        localStream?.getTracks()?.forEach((t) => t.stop())
      } catch {}
    }
  }, [cameraOn])

  function ext(f: File | null) { return f ? String(f.name.split('.').pop() || 'jpg').toLowerCase() : 'jpg' }
  function captureToFile(name: string) {
    if (!videoEl) return null
    const cvs = document.createElement('canvas')
    cvs.width = videoEl.videoWidth || 640
    cvs.height = videoEl.videoHeight || 480
    const ctx = cvs.getContext('2d')!
    ctx.drawImage(videoEl, 0, 0, cvs.width, cvs.height)
    return new Promise<File | null>((resolve) => {
      cvs.toBlob((b) => { resolve(b ? new File([b], name, { type: 'image/jpeg' }) : null) }, 'image/jpeg', 0.9)
    })
  }

  async function waitForVideoReady(): Promise<void> {
    if (!videoEl) return
    if (videoEl.readyState >= 2) return
    await new Promise<void>((resolve) => {
      const onReady = () => {
        videoEl?.removeEventListener('loadeddata', onReady)
        resolve()
      }
      videoEl.addEventListener('loadeddata', onReady)
    })
  }

  const runAutoCapture = async () => {
    if (autoCaptureRunning) return
    if (!cameraOn) setCameraOn(true)
    setAutoCaptureRunning(true)
    setAutoCaptureStep('')
    try {
      await waitForVideoReady()
      const steps = [
        { label: t('pose_neutral'), setter: setSelfieNeutral, filename: 'selfie_neutral.jpg' },
        { label: t('pose_smile'), setter: setSelfieSmile, filename: 'selfie_smile.jpg' },
        { label: t('pose_left'), setter: setSelfieLeft, filename: 'selfie_left.jpg' },
        { label: t('pose_right'), setter: setSelfieRight, filename: 'selfie_right.jpg' },
      ]
      for (const s of steps) {
        setAutoCaptureStep(s.label)
        // Give the user time to adjust before capture
        for (let i = 3; i >= 1; i--) {
          setAutoCountdown(i)
          // If user stopped auto mode, break out
          if (!cameraOn) break
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 1000))
        }
        setAutoCountdown(null)
        if (!cameraOn) break
        const file = await captureToFile(s.filename)
        if (file) s.setter(file)
      }
      setAutoCaptureStep(t('captured'))
    } finally {
      setAutoCaptureRunning(false)
    }
  }
  function getImageData(file: File): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const cvs = document.createElement('canvas')
        cvs.width = img.naturalWidth
        cvs.height = img.naturalHeight
        const ctx = cvs.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, cvs.width, cvs.height))
      }
      img.onerror = (e) => reject(e)
      const url = URL.createObjectURL(file)
      img.src = url
    })
  }
  function diffPercent(a: ImageData, b: ImageData): number {
    const w = Math.min(a.width, b.width)
    const h = Math.min(a.height, b.height)
    let diff = 0
    let total = w * h
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const dr = Math.abs(a.data[i] - b.data[i])
        const dg = Math.abs(a.data[i+1] - b.data[i+1])
        const db = Math.abs(a.data[i+2] - b.data[i+2])
        const d = (dr + dg + db) / 3
        if (d > 25) diff++
      }
    }
    return Math.round((diff / total) * 1000) / 10
  }

  async function submit() {
    setLoading(true)
    setMsg('')
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) throw new Error('Session expired')
      const { data: user } = await supabase.auth.getUser()
      const uid = user.user?.id
      if (!uid) throw new Error('Not authenticated')
      const idTypeDef = countrySchemas[country]?.idTypes.find((t) => t.value === idType)
      const idPattern = idTypeDef?.pattern
      if (!fullName || !dob || !address || !idType || !idNumber || !idFile) throw new Error('Fill all fields and attach files')
      if (idPattern && !idPattern.test(idNumber)) throw new Error('ID number format invalid for selected country/type')
      if (!selfieNeutral || !selfieSmile || !selfieLeft || !selfieRight) throw new Error('Capture all selfie steps (neutral, smile, left, right)')
      if (idFile.size > 6_000_000) throw new Error('ID file too large')
      const idOk = ['image/jpeg','image/png','application/pdf'].includes(idFile.type)
      if (!idOk) throw new Error('Invalid ID file type')
      const selfieFiles = [selfieNeutral, selfieSmile, selfieLeft, selfieRight]
      for (const s of selfieFiles) {
        if (s!.size > 6_000_000) throw new Error('Selfie too large')
        const ok = ['image/jpeg','image/png'].includes(s!.type)
        if (!ok) throw new Error('Invalid selfie file type')
      }

      const imgNeutral = await getImageData(selfieNeutral!)
      const imgSmile = await getImageData(selfieSmile!)
      const imgLeft = await getImageData(selfieLeft!)
      const imgRight = await getImageData(selfieRight!)
      const metrics = {
        diff_smile_vs_neutral: diffPercent(imgNeutral, imgSmile),
        diff_left_vs_neutral: diffPercent(imgNeutral, imgLeft),
        diff_right_vs_neutral: diffPercent(imgNeutral, imgRight),
      }
      const toDataUrl = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result || '')); r.onerror = (e) => reject(e); r.readAsDataURL(f) })
      const body = {
        idFileDataUrl: await toDataUrl(idFile!),
        selfieNeutralDataUrl: await toDataUrl(selfieNeutral!),
        selfieSmileDataUrl: await toDataUrl(selfieSmile!),
        selfieLeftDataUrl: await toDataUrl(selfieLeft!),
        selfieRightDataUrl: await toDataUrl(selfieRight!),
        payload: { fullName, dob, address, country, idType, idNumber, idExpiry, level, livenessMetrics: metrics },
      }
      const upRes = await fetch('/api/kyc/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const upJson = await upRes.json()
      if (!upRes.ok) throw new Error(upJson.error || 'Upload failed')

      const res = await fetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ level }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Submit failed')
      setMsg(t('kyc_submitted_msg'))
      setIsSubmitted(true)
      setFullName('')
      setDob('')
      setAddress('')
      setIdType('national_id')
      setIdNumber('')
      setIdFile(null)
      setSelfieNeutral(null)
      setSelfieSmile(null)
      setSelfieLeft(null)
      setSelfieRight(null)
      setStep(1)
      setCameraOn(false)
      load()
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setLoading(false)
    }
  }

  const status = String(profile?.kyc_status || 'pending').toLowerCase()
  const submittedAt = profile?.kyc_submitted_at ? new Date(profile.kyc_submitted_at).toLocaleString() : null

  return (
    <RequireAuth>
      <div className="min-h-screen bg-background py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
              <IdCard className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{t('kyc_title')}</h1>
              <p className="text-sm text-muted-foreground">{t('kyc_subtitle')}</p>
            </div>
          </div>
          {msg && <p className={`mb-3 text-sm ${status==='approved' ? 'text-success' : status==='rejected' ? 'text-destructive' : 'text-primary'}`}>{msg}</p>}
          <div className="rounded-2xl shadow-xl border border-border p-6 space-y-4 bg-card text-card-foreground">
            <p className="text-sm flex flex-wrap items-center gap-2">
              {t('status_label')}
              <span className={`px-2 py-1 rounded text-xs capitalize ${status==='approved'?'bg-success/10 text-success':status==='rejected'?'bg-destructive/10 text-destructive':'bg-warning/10 text-warning'}`}>{status}</span>
              {typeof profile?.kyc_level === 'number' && (
                <span className="text-xs text-muted-foreground">
                  • {t('kyc_level_label')} {profile.kyc_level}
                </span>
              )}
            </p>
            {submittedAt && <p className="text-sm text-muted-foreground">{t('submitted_label')} {submittedAt}</p>}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${step>=1? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><UserIcon className="h-4 w-4" /></div>
              <div className={`h-1 w-10 rounded ${step>=2? 'bg-primary' : 'bg-muted'}`} />
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${step>=2? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><IdCard className="h-4 w-4" /></div>
              <div className={`h-1 w-10 rounded ${step>=3? 'bg-primary' : 'bg-muted'}`} />
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${step>=3? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><Camera className="h-4 w-4" /></div>
              <div className={`h-1 w-10 rounded ${step>=4? 'bg-primary' : 'bg-muted'}`} />
              <div className={`h-8 w-8 rounded-full flex items-center justify-center ${step>=4? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}><CheckCircle className="h-4 w-4" /></div>
            </div>
            <div className="text-xs text-muted-foreground">{t('step_of', { step, total: 4 })}</div>
          </div>
          {step===1 && (
            <>
              <label className="block text-sm font-medium text-foreground">{t('full_name_label')}</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder="John Doe" />
              <label className="block text-sm font-medium text-foreground">{t('dob_label')}</label>
              <input value={dob} onChange={(e) => setDob(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" type="date" />
              <label className="block text-sm font-medium text-foreground">{t('address_label')}</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Street, City, Country" />
              <label className="block text-sm font-medium text-foreground">{t('kyc_level_label')}</label>
              <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="border border-input rounded px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                {[1,2,3].map(l => <option key={l} value={l}>{t('level_value', { l })}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="bg-primary hover:bg-primary/90 transition text-primary-foreground rounded-lg px-4 py-2">{t('next')}</button>
              </div>
            </>
          )}
          {step===2 && (
            <>
              <label className="block text-sm font-medium text-foreground">{t('gov_id_type_label')}</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-foreground">{t('country_label')}</label>
                  <select
                    value={country}
                    onChange={(e) => {
                      const next = e.target.value
                      setCountry(next)
                      const first = countrySchemas[next]?.idTypes[0]?.value
                      if (first) setIdType(first)
                    }}
                    className="border border-input rounded px-3 py-2 w-full bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {Object.keys(countrySchemas).map((c) => (<option key={c} value={c}>{countrySchemas[c].name}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-foreground">{t('id_type_label')}</label>
                  <select value={idType} onChange={(e) => setIdType(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                    {(countrySchemas[country]?.idTypes || []).map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                  </select>
                </div>
              </div>
              <label className="block text-sm font-medium text-foreground">{t('gov_id_number_label')}</label>
              <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" placeholder="ID Number" />
              <label className="block text-sm font-medium text-foreground">{t('id_expiry_label')}</label>
              <input value={idExpiry} onChange={(e) => setIdExpiry(e.target.value)} className="border border-input rounded px-3 py-2 w-full bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary" type="date" />
              <label className="block text-sm font-medium text-foreground">{t('upload_gov_id_label')}</label>
              <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                <input onChange={(e) => setIdFile(e.target.files?.[0] || null)} className="w-full text-foreground" type="file" accept="image/*,application/pdf" />
                <p className="text-xs text-muted-foreground mt-1">{t('accepted_files_note')}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="border border-input text-primary rounded-lg px-4 py-2 hover:bg-accent hover:text-accent-foreground">{t('back')}</button>
                <button onClick={() => setStep(3)} className="bg-primary hover:bg-primary/90 transition text-primary-foreground rounded-lg px-4 py-2">{t('next')}</button>
              </div>
            </>
          )}
          {step===3 && (
            <>
              <label className="block text-sm font-medium text-foreground">{t('selfie_liveness_label')}</label>
              <p className="text-xs text-muted-foreground mb-2">
                {t('selfie_instructions')}
              </p>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => setCameraOn((v) => !v)}
                      className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm hover:opacity-90"
                    >
                      {cameraOn ? t('stop_camera') : t('start_camera')}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {cameraOn ? t('camera_on') : t('camera_off')}
                    </span>
                  </div>
                  <video
                    id="kyc-selfie-video"
                    className="w-full rounded-lg border border-border shadow-sm bg-black/5"
                    autoPlay
                    muted
                    playsInline
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={autoCaptureRunning}
                      onClick={runAutoCapture}
                      className="bg-secondary text-secondary-foreground rounded px-4 py-2 text-sm disabled:opacity-60 hover:opacity-90"
                    >
                      {autoCaptureRunning ? t('capturing') : t('auto_capture')}
                    </button>
                    <span className="text-xs text-muted-foreground text-right">
                      {autoCaptureStep
                        ? `${autoCaptureStep}${autoCountdown !== null ? ` • ${t('countdown')} ${autoCountdown}` : ''}`
                        : t('auto_capture_hint')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-3">
                  <div className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{t('capture_neutral')}</span>
                      {selfieNeutral && <span className="text-xs text-success">{t('captured')}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => { const f = await captureToFile('selfie_neutral.jpg'); if (f) setSelfieNeutral(f) }}
                        className="border border-input rounded-lg px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        {t('use_camera')}
                      </button>
                      <input
                        onChange={(e) => setSelfieNeutral(e.target.files?.[0] || null)}
                        className="border border-input rounded px-3 py-1 text-xs text-foreground"
                        type="file"
                        accept="image/*"
                      />
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{t('capture_smile')}</span>
                      {selfieSmile && <span className="text-xs text-success">{t('captured')}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => { const f = await captureToFile('selfie_smile.jpg'); if (f) setSelfieSmile(f) }}
                        className="border border-input rounded-lg px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        {t('use_camera')}
                      </button>
                      <input
                        onChange={(e) => setSelfieSmile(e.target.files?.[0] || null)}
                        className="border border-input rounded px-3 py-1 text-xs text-foreground"
                        type="file"
                        accept="image/*"
                      />
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{t('capture_left')}</span>
                      {selfieLeft && <span className="text-xs text-success">{t('captured')}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => { const f = await captureToFile('selfie_left.jpg'); if (f) setSelfieLeft(f) }}
                        className="border border-input rounded-lg px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        {t('use_camera')}
                      </button>
                      <input
                        onChange={(e) => setSelfieLeft(e.target.files?.[0] || null)}
                        className="border border-input rounded px-3 py-1 text-xs text-foreground"
                        type="file"
                        accept="image/*"
                      />
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{t('capture_right')}</span>
                      {selfieRight && <span className="text-xs text-success">{t('captured')}</span>}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => { const f = await captureToFile('selfie_right.jpg'); if (f) setSelfieRight(f) }}
                        className="border border-input rounded-lg px-3 py-1 text-sm hover:bg-accent hover:text-accent-foreground"
                      >
                        {t('use_camera')}
                      </button>
                      <input
                        onChange={(e) => setSelfieRight(e.target.files?.[0] || null)}
                        className="border border-input rounded px-3 py-1 text-xs text-foreground"
                        type="file"
                        accept="image/*"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setStep(2)} className="border border-input text-primary rounded-lg px-4 py-2 hover:bg-accent hover:text-accent-foreground">{t('back')}</button>
                <button onClick={() => setStep(4)} className="bg-primary hover:bg-primary/90 transition text-primary-foreground rounded-lg px-4 py-2">{t('next')}</button>
              </div>
            </>
          )}
          {step===4 && (
            <>
              <div className="text-sm text-foreground">{t('review_and_submit')}</div>
              <button disabled={loading || status==='approved'} onClick={submit} className="bg-primary hover:bg-primary/90 transition text-primary-foreground rounded-lg px-4 py-2 disabled:opacity-50">
                {loading ? t('submitting') : (status==='approved' ? t('already_approved') : t('submit_kyc'))}
              </button>
              <button onClick={() => setStep(3)} className="border border-input text-primary rounded-lg px-4 py-2 ml-2 hover:bg-accent hover:text-accent-foreground">{t('back')}</button>
            </>
          )}
          </div>
        </div>
      </div>
    </RequireAuth>
  )
}
