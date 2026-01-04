import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

import { supabaseServer } from '../src/lib/supabaseServer'

async function checkSchema() {
    if (!supabaseServer) {
        console.error('supabaseServer is not configured')
        process.exit(1)
    }
    const { data, error } = await supabaseServer.from('Investment').select('*').limit(1)
    if (error) {
        console.error('Error:', error)
    } else {
        console.log('Columns:', data && data.length > 0 ? Object.keys(data[0]) : 'No data')
    }
}

checkSchema()
