const _ = require('lodash')
const fs = require('fs')
const csv = require('csvtojson')

//const TASKS = _.shuffle(require('./data/tasks.json'))
const STAFFS = _.shuffle(require('./data/staffs.json'))
const REQUIREMENTS = require('./data/requirements.json')
const UNAVAILABLES = require('./data/unavailables.json')
const PREASSIGNED_TASKS = require('./data/preassigned.json')

const workloads = STAFFS.map(({ name, shift }) => ({
  shift,
  name,
  workload: 0
}))

const schedules = [
  { name: 'mon', tasks: [] },
  { name: 'tue', tasks: [] },
  { name: 'wed', tasks: [] },
  { name: 'thu', tasks: [] },
  { name: 'fri', tasks: [] }
]

const unassignedTasks = []

async function main() {
  const TASKS = await csv({
    ignoreEmpty: true,
    nullObject: true
  }).fromFile('./data/tasks.csv')

  //console.log(TASKS)
  const CONFLICTS = REQUIREMENTS.conflicts
  const ONE_PERSON_TASKS = REQUIREMENTS.onePersonTasks

  schedules.forEach((schedule) => {
    const weekday = schedule.name
    const assignedSchedules = []

    TASKS.filter(({ weekdays }) => weekdays.includes(weekday)).forEach(
      (task) => {
        const { name, cat, staffs, trainers, trainees, shifts, duration } = task
        const dayOffStaffs = UNAVAILABLES[weekday] || []

        shifts.forEach(function (shift) {
          const availableStaffs = getAvailableStaffs(
            {
              name,
              cat,
              shift,
              staffs,
              trainers,
              trainees
            },
            assignedSchedules,
            dayOffStaffs
          )

          if (availableStaffs.length == 0) {
            unassignedTasks.push({
              weekday,
              name,
              shift,
              staffs: _.map(getStaffsInListByShift(staffs, shift), 'name'),
              trainers: _.map(getStaffsInListByShift(trainers, shift), 'name'),
              trainees: _.map(getStaffsInListByShift(trainees, shift), 'name')
            })
            return
          }

          const assignedStaff = assignTaskToStaff(availableStaffs, workloads)

          const assignedTrainees = assignTaskToTrainees(trainees, dayOffStaffs)

          updateWorkloads([assignedStaff, ...assignedTrainees], duration)

          assignedSchedules.push({
            name,
            shift,
            weekday,
            cat,
            staff: assignedStaff.name,
            trainees: _.map(assignedTrainees, 'name')
          })
        })
      }
    )

    schedule.tasks = _.sortBy(assignedSchedules, [
      'shift',
      'staff',
      'cat',
      'name'
    ])
  })

  console.log('# Workloads:\n', _.sortBy(workloads, ['shift', 'name']))
  console.log('\n')
  console.log('# Unassigned Tasks:\n', unassignedTasks)

  const flattenSchedules = _.reduce(
    schedules,
    (prev, task) => {
      prev.push(...task.tasks)
      return prev
    },
    []
  )
  const traineeSchedules = flattenSchedules.filter(
    ({ trainees }) => trainees.length > 0
  )

  //const result = _(flattenSchedules)
  //  .groupBy('shift')
  //  .mapValues((task) => {
  //    const groupedTasks = _.groupBy(task, 'trainer')
  //    const result = _.mapValues(groupedTasks, (task) => {
  //      return _.groupBy(task, 'weekday')
  //    })
  //    return result
  //  })
  //  .value()

  const result = _.map(STAFFS, (s) => {
    s.schedules = schedules.map((schedule) => {
      const tasks = schedule.tasks.filter((t) => {
        return t.staff == s.name
      })
      return {
        weekday: schedule.name,
        tasks
      }
    })
    return s
  })

  const writeFileData = [
    { filename: './out/tasks.json', content: TASKS },
    { filename: './out/staffs.json', content: STAFFS },
    { filename: './out/assignedSchedules.json', content: result },
    { filename: './out/traineeSchedules.json', content: traineeSchedules },
    {
      filename: './out/workloads.json',
      content: _.sortBy(workloads, ['shift', 'name'])
    },
    { filename: './out/unassignedTasks.json', content: unassignedTasks },
    { filename: './out/dayOffs.json', content: UNAVAILABLES }
  ]

  writeFileData.forEach(({ filename, content }) => {
    fs.writeFileSync(filename, JSON.stringify(content, null, 2), 'utf8')
  })

  function getAvailableStaffs(task, assignedSchedules, dayOffStaffs) {
    const { name, cat, shift } = task
    const staffs = _.compact(task.staffs) || []
    const trainers = _.compact(task.trainers) || []
    const trainees = _.compact(task.trainees) || []

    const preassignedStaffs = _(STAFFS)
      .shuffle()
      .filter((s) => {
        const found = PREASSIGNED_TASKS.find((t) => {
          return t.name == name && t.shift == shift
        })

        if (found) {
          return found.staffs.includes(s.name) && !dayOffStaffs.includes(s.name)
        }

        return false
      })
      .value()

    if (preassignedStaffs.length > 0) return preassignedStaffs

    if (name == 'Invoice-Citi/JPM	' && shift == 'Asia') {
      console.log(staffs, trainers, trainees)
    }

    const shiftTrainers = getStaffsInListByShift(trainers, shift)
    const shiftTrainees = getStaffsInListByShift(trainees, shift)
    const shiftStaffs = getStaffsInListByShift(staffs, shift)
    const targets = []

    if (shiftTrainees.length > 0 && shiftTrainers.length > 0) {
      targets.push(...shiftTrainers)
    } else {
      targets.push(...shiftStaffs)
    }

    const matchedStaffs = _.filter(targets, (s) => {
      if (dayOffStaffs.includes(s.name)) return false

      // ignore conflict task if the task has trainees
      if (trainees.length == 0) {
        // CONFLICTS is a 2D array
        const conflictCategories = _(CONFLICTS)
          .filter((pairs) => pairs.includes(cat))
          .flatten()
          .filter((c) => c != cat)
          .value()

        const doingConflictedTaskStaffs = assignedSchedules.filter((t) => {
          // check if the staff assigned to any conflict task
          return t.staff == s.name && conflictCategories.includes(t.cat)
        })

        if (doingConflictedTaskStaffs.length > 0) {
          return false
        }
      }

      return true
    })

    const assignedOnePersonTaskStaffs = _.filter(matchedStaffs, (s) => {
      const isOnePersonTask = ONE_PERSON_TASKS.includes(cat)

      if (isOnePersonTask) {
        const assignedOnePersonTasks = assignedSchedules.filter((t) => {
          return t.cat == cat && t.shift == s.shift
        })

        if (assignedOnePersonTasks.length == 0) return true

        const found = assignedOnePersonTasks.find(
          (t) => t.staff == s.name && t.shift == s.shift
        )

        if (found) return true

        return false
      }

      return true
    })

    if (assignedOnePersonTaskStaffs.length > 0)
      return assignedOnePersonTaskStaffs

    return matchedStaffs
  }
}

function assignTaskToStaff(availableStaffs, workloads) {
  // workload: name shift workload
  const sorted = _.sortBy(
    availableStaffs,
    function (s) {
      const found = workloads.find((w) => w.name == s.name)
      if (found) {
        return found.workload
      }
      return 0
    },
    ['asc']
  )
  return sorted[0]
}

function assignTaskToTrainees(trainees, dayOffStaffs) {
  const traineeNames = _.filter(trainees, function (trainee) {
    return !dayOffStaffs.includes(trainee)
  })
  return _.filter(STAFFS, (s) => traineeNames.includes(s.name))
}

function updateWorkloads(staffs, duration) {
  staffs.forEach((staff) => {
    const found = workloads.find((w) => w.name == staff.name)
    if (found) {
      found.workload += parseFloat(duration)
    }
  })
}

function getStaffsInListByShift(list, shift) {
  if (!list) return []

  return _(STAFFS)
    .filter((s) => {
      return s.shift == shift && list.includes(s.name)
    })
    .value()
}

main()
